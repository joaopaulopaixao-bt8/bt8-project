// Auxiliares das Functions do Módulo Arena (admin-arena, arena-member, arena-register).
// A parte pura (validação e normalização) é testada em tests/arena-functions.test.js.
const crypto = require('crypto');
const { logError } = require('./_log');

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

// Data AAAA-MM-DD que existe no calendário (2027-02-31 não passa).
function dataValida(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

// Erro com mensagem própria da função, que pode ir para o usuário.
function erroPublico(status, mensagem) {
  const e = new Error(mensagem);
  e.status = status;
  e.publico = true;
  return e;
}

// Só vão para o usuário as mensagens da própria função e as recusas de negócio da 004/005 (com hint).
// O resto (mensagens internas do Supabase/GoTrue, em inglês) vira mensagem genérica e vai para o log.
function respostaDeErro(contexto, e, generica) {
  if (e?.publico) return json(e.status || 400, { error: e.message });
  if (e?.code === 'P0001' && e.hint) return json(400, { error: e.message, erro: e.hint });
  logError(contexto, e);
  return json(500, { error: generica });
}

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
  if (!dataValida(arena.ativo_ate)) return { erro: 'Data "ativo até" inválida (AAAA-MM-DD).' };
  const gestor = validarPessoa(g);
  if (gestor.erro) return gestor;
  return { arena, gestor };
}

// Nome, e-mail e senha inicial. A senha é sempre exigida (e ignorada se a conta já existir), para a
// resposta não revelar se o e-mail tem conta no BT8.
function validarPessoa(p) {
  const nome = limparNome(p?.nome);
  const email = String(p?.email ?? '').trim().toLowerCase();
  const senha = String(p?.senha ?? '');
  if (!nome) return { erro: 'Informe o nome.' };
  if (!emailValido(email)) return { erro: 'E-mail inválido.' };
  if (senha.length < 8 || senha.length > 72) return { erro: 'A senha inicial precisa ter de 8 a 72 caracteres.' };
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

// Conta existente pelo e-mail em auth.users (RPC só da service role, nunca profiles.email, que é
// do usuário) ou nova conta já confirmada.
async function obterOuCriarUsuario(env, { nome, email, senha }) {
  const existente = await sbFetch(env, 'rest/v1/rpc/arena_conta_por_email', {
    method: 'POST', body: JSON.stringify({ p_email: email })
  });
  if (existente) return { userId: existente, criada: false };
  const user = await sbFetch(env, 'auth/v1/admin/users', {
    method: 'POST',
    // Senha escolhida pelo gestor/admin: a pessoa troca no primeiro login (arena-trocar-senha). Sem isso,
    // se o e-mail for de outra pessoa que depois entra com Google, quem criou continuaria sabendo a senha.
    body: JSON.stringify({ email, password: senha, email_confirm: true, user_metadata: { full_name: nome },
      app_metadata: { trocar_senha: true } })
  });
  return { userId: user.id, criada: true };
}

// Desfaz uma conta criada nesta chamada quando o resto falhou (sem conta órfã).
const apagarUsuario = (env, userId) => sbFetch(env, `auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' })
  .catch(e => logError('arena-apagar-usuario', e));

// Arena ativa e dentro do prazo do plano?
// Data de hoje (AAAA-MM-DD) em São Paulo: ativo_ate vale até o fim do dia no horário da arena.
const hojeSaoPaulo = (agora = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);

// Nova senha da troca obrigatória: mesmas regras da tela (8+, 1 letra e 1 número; GoTrue aceita até 72).
function validarNovaSenha(v) {
  const senha = String(v ?? '');
  if (senha.length < 8 || senha.length > 72 || !/[a-zA-Z]/.test(senha) || !/[0-9]/.test(senha)) {
    return { erro: 'A senha precisa ter de 8 a 72 caracteres, com pelo menos 1 letra e 1 número.' };
  }
  return { senha };
}

async function arenaAtiva(env, arenaId) {
  const [a] = await sbFetch(env, `rest/v1/arenas?select=status,ativo_ate&id=eq.${encodeURIComponent(arenaId)}&limit=1`);
  if (!a) return false;
  return a.status === 'ativa' && (!a.ativo_ate || a.ativo_ate >= hojeSaoPaulo());
}

module.exports = {
  ARENA_LGPD_VERSAO, PAPEIS_EQUIPE, json, hojeSaoPaulo, validarNovaSenha, dataValida, erroPublico, respostaDeErro, apagarUsuario, arenaAtiva, limparNome, normalizarTelefone, emailValido, uuidValido,
  validarInscricao, statusDaRecusa, validarArena, validarPessoa, validarMembro, hashIp, clientIp,
  supabaseEnv, sbFetch, usuarioDoToken, ehAdmin, obterOuCriarUsuario
};
