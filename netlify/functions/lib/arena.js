// Auxiliares das Functions do Módulo Arena (admin-arena, arena-member, arena-register).
// A parte pura (validação e normalização) é testada em tests/arena-functions.test.js.
const crypto = require('crypto');

// Mesma versão de BT8_ARENA_LGPD_VERSAO em src/js/legal-pages.js (o teste confere).
const ARENA_LGPD_VERSAO = '2026-11-22';
const PAPEIS_EQUIPE = ['gestor', 'arbitro', 'scout'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization'
  },
  body: JSON.stringify(body)
});

const texto = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

function limparNome(v) {
  const nome = texto(v, 200);
  return nome.length >= 2 && nome.length <= 80 ? nome : null;
}

// Telefone para E.164. Sem "+": número brasileiro (DDD + número, com ou sem 55 ou 0 na frente).
function normalizarTelefone(v) {
  const bruto = String(v ?? '').trim();
  let d = bruto.replace(/\D/g, '');
  if (!bruto.startsWith('+')) {
    if (d.startsWith('0')) d = d.replace(/^0+/, '');
    if (d.length === 10 || d.length === 11) d = '55' + d;
    else if (!((d.length === 12 || d.length === 13) && d.startsWith('55'))) return null;
  }
  return /^[1-9]\d{7,14}$/.test(d) ? '+' + d : null;
}

const emailValido = v => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);
const uuidValido = v => typeof v === 'string' && UUID_RE.test(v);

// Corpo do POST /arena-register -> { honeypot } | { erro } | { token, dados } (dados = p_dados da RPC).
function validarInscricao(body, versaoAtual = ARENA_LGPD_VERSAO) {
  if (!body || typeof body !== 'object') return { erro: 'Dados inválidos.' };
  if (String(body.website ?? '').trim()) return { honeypot: true };
  const token = String(body.token ?? '');
  if (!/^[A-Za-z0-9-]{16,64}$/.test(token)) return { erro: 'Link de inscrição inválido.' };
  if (!uuidValido(body.categoria_id)) return { erro: 'Escolha a categoria.' };
  if (body.lgpd !== true) return { erro: 'É preciso aceitar o uso dos dados para se inscrever.' };
  if (body.lgpd_versao !== versaoAtual) return { erro: 'O termo de uso dos dados mudou. Recarregue a página e aceite de novo.' };
  const atletas = [];
  for (const [i, a] of [[1, body.atleta1], [2, body.atleta2]]) {
    const nome = limparNome(a?.nome);
    if (!nome) return { erro: `Informe o nome do atleta ${i}.` };
    const telefone = normalizarTelefone(a?.telefone);
    if (!telefone) return { erro: `WhatsApp do atleta ${i} inválido. Use DDD + número.` };
    atletas.push({ nome, telefone });
  }
  if (atletas[0].telefone === atletas[1].telefone) return { erro: 'Os dois atletas precisam ter WhatsApp diferentes.' };
  return {
    token,
    dados: { category_id: body.categoria_id, consentimento_versao: versaoAtual, atleta1: atletas[0], atleta2: atletas[1] }
  };
}

// Recusa de arena_inscrever -> status HTTP.
const statusDaRecusa = erro => ({ limite: 429, nao_encontrado: 404 }[erro] || 400);

function validarArena(body) {
  const a = body?.arena || {};
  const g = body?.gestor || {};
  const arena = {
    nome: texto(a.nome, 120),
    slug: String(a.slug ?? '').trim().toLowerCase(),
    cidade: texto(a.cidade, 80) || null,
    estado: texto(a.estado, 2).toUpperCase() || null,
    whatsapp: a.whatsapp ? normalizarTelefone(a.whatsapp) : null,
    plano: texto(a.plano, 40) || 'fundadora',
    ativo_ate: a.ativo_ate || '2027-03-31'
  };
  if (!arena.nome) return { erro: 'Informe o nome da arena.' };
  if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(arena.slug)) return { erro: 'Slug inválido: use letras minúsculas, números e hífen.' };
  if (a.whatsapp && !arena.whatsapp) return { erro: 'WhatsApp da arena inválido.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(arena.ativo_ate)) return { erro: 'Data "ativo até" inválida (AAAA-MM-DD).' };
  const gestor = validarPessoa(g);
  if (gestor.erro) return gestor;
  return { arena, gestor };
}

// Nome, e-mail e senha opcional (exigida só se a conta for criada).
function validarPessoa(p) {
  const nome = limparNome(p?.nome);
  const email = String(p?.email ?? '').trim().toLowerCase();
  const senha = p?.senha ? String(p.senha) : null;
  if (!nome) return { erro: 'Informe o nome.' };
  if (!emailValido(email)) return { erro: 'E-mail inválido.' };
  if (senha && (senha.length < 8 || senha.length > 72)) return { erro: 'A senha inicial precisa ter de 8 a 72 caracteres.' };
  return { nome, email, senha };
}

function validarMembro(body) {
  const acao = body?.acao || 'criar';
  if (!uuidValido(body?.arena_id)) return { erro: 'Arena inválida.' };
  if (acao === 'atualizar') {
    if (!uuidValido(body.member_id)) return { erro: 'Membro inválido.' };
    const patch = {};
    if (body.papel !== undefined) {
      if (!PAPEIS_EQUIPE.includes(body.papel)) return { erro: 'Papel inválido.' };
      patch.papel = body.papel;
    }
    if (body.ativo !== undefined) patch.ativo = body.ativo === true;
    if (body.nome !== undefined) {
      patch.nome = limparNome(body.nome);
      if (!patch.nome) return { erro: 'Informe o nome.' };
    }
    if (!Object.keys(patch).length) return { erro: 'Nada para atualizar.' };
    return { acao, arena_id: body.arena_id, member_id: body.member_id, patch };
  }
  if (acao !== 'criar') return { erro: 'Ação inválida.' };
  if (!PAPEIS_EQUIPE.includes(body.papel)) return { erro: 'Papel inválido: gestor, árbitro ou scout.' };
  if (body.sem_conta) {
    if (body.papel !== 'arbitro') return { erro: 'Só árbitro pode ser cadastrado sem conta.' };
    const nome = limparNome(body.nome);
    if (!nome) return { erro: 'Informe o nome.' };
    return { acao, arena_id: body.arena_id, papel: 'arbitro', sem_conta: true, pessoa: { nome } };
  }
  const pessoa = validarPessoa(body);
  if (pessoa.erro) return pessoa;
  return { acao, arena_id: body.arena_id, papel: body.papel, pessoa };
}

const hashIp = (secret, ip) => crypto.createHash('sha256').update(`arena:${secret}:${ip || 'unknown'}`).digest('hex');

const clientIp = (headers = {}) => headers['x-nf-client-connection-ip'] || headers['client-ip'] ||
  String(headers['x-forwarded-for'] || '').split(',')[0].trim();

// ── Supabase (service role) ──
function supabaseEnv() {
  return {
    url: process.env.BT8_SUPABASE_URL || process.env.SUPABASE_URL,
    serviceKey: process.env.BT8_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  };
}

async function sbFetch(env, path, options = {}) {
  const res = await fetch(`${env.url}/${path}`, {
    ...options,
    headers: {
      apikey: env.serviceKey,
      authorization: options.authorization || `Bearer ${env.serviceKey}`,
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const raw = await res.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (e) { data = raw; }
  if (!res.ok) {
    const err = new Error(data?.message || data?.msg || data?.error_description || data?.error || `Supabase ${res.status}`);
    err.status = res.status;
    err.code = data?.code || data?.error_code;
    err.hint = data?.hint;
    throw err;
  }
  return data;
}

// Usuário do token (Authorization: Bearer) ou null.
async function usuarioDoToken(env, event) {
  const token = String(event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const user = await sbFetch(env, 'auth/v1/user', { method: 'GET', authorization: `Bearer ${token}` }).catch(() => null);
  return user?.id ? user : null;
}

async function ehAdmin(env, userId) {
  const rows = await sbFetch(env, `rest/v1/profiles?select=role&id=eq.${encodeURIComponent(userId)}&limit=1`);
  return rows?.[0]?.role === 'admin';
}

// Conta existente pelo e-mail (profiles.email) ou nova conta já confirmada.
async function obterOuCriarUsuario(env, { nome, email, senha }) {
  const rows = await sbFetch(env, `rest/v1/profiles?select=id&email=eq.${encodeURIComponent(email)}&limit=1`);
  if (rows?.[0]?.id) return { userId: rows[0].id, criada: false };
  if (!senha) {
    const err = new Error('Esse e-mail ainda não tem conta: informe a senha inicial.');
    err.status = 400;
    throw err;
  }
  const user = await sbFetch(env, 'auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password: senha, email_confirm: true, user_metadata: { full_name: nome } })
  });
  return { userId: user.id, criada: true };
}

module.exports = {
  ARENA_LGPD_VERSAO, PAPEIS_EQUIPE, json, limparNome, normalizarTelefone, emailValido, uuidValido,
  validarInscricao, statusDaRecusa, validarArena, validarPessoa, validarMembro, hashIp, clientIp,
  supabaseEnv, sbFetch, usuarioDoToken, ehAdmin, obterOuCriarUsuario
};
