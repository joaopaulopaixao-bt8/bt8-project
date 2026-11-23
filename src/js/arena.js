// Painel da arena (Minha arena, equipe, quadras, campeonato, capacidade, inscritos, sorteio, grupos e chave). Agente A3.
// Contrato com o backend: docs/ARENA.md. Motor: window.BT8Championship (championship.js).
// Com ?demo=1 fora de produção, tudo roda contra um banco simulado no navegador (ARENA_DEMO).

const ARENA = { arenas: [], arena: null, papel: null, tab: 'campeonatos', quadras: [], membros: [], camps: [], c: null, catId: null, draft: {}, capBase: 'inscritas', timer: null };
let ARENA_MEMBROS = { uid: null, lista: [] };

const AR_STATUS_CAMP = { rascunho: 'Rascunho', inscricoes: 'Inscrições abertas', em_andamento: 'Em andamento', encerrado: 'Encerrado' };
const AR_STATUS_DUPLA = { confirmada: 'Confirmada', pendente: 'Aguardando Pix', espera: 'Lista de espera', cancelada: 'Cancelada' };
const AR_STATUS_JOGO = { agendada: 'Agendada', chamada: 'Chamada', em_jogo: 'Em jogo', suspensa: 'Suspensa', encerrada: 'Encerrada', wo: 'WO', anulada: 'Anulada' };
const AR_FASE = { grupo: 'Grupo', r16: 'Oitavas', qf: 'Quartas', sf: 'Semifinal', final: 'Final' };
const AR_PAPEL = { dono: 'Dono', gestor: 'Gestor', arbitro: 'Árbitro', scout: 'Scout', admin: 'Admin BT8' };
const AR_FORMATO_PADRAO = { tam_grupo: 4, classificam: 2, preset_grupo: 'A', preset_mata: 'A' };

// ── Utilidades ───────────────────────────────────────────
const arEsc = v => escapeHtml(v);
const arClone = v => JSON.parse(JSON.stringify(v));
const arG = () => ['dono', 'gestor', 'admin'].includes(ARENA.papel);
const arData = d => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '-');
// timestamptz vem em UTC (23:59 de SP = 02:59Z do dia seguinte): o dia do prazo é lido no fuso de São Paulo.
const arDiaSP = ts => (ts ? new Date(ts).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) : '');
const arAtiva = t => t.status === 'confirmada' || t.status === 'pendente';

function arenaPainelDemo() {
  try {
    const h = location.hostname;
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(h) || /\.(localhost|test)$/.test(h);
    return new URLSearchParams(location.search).get('demo') === '1' && (local || (window.BT8_ENV?.APP_ENV || 'production') !== 'production');
  } catch { return false; }
}

function arUid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const arToken = () => [...crypto.getRandomValues(new Uint8Array(12))].map(x => x.toString(16).padStart(2, '0')).join('');
const arSlug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const arRandom = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;

// Mesmo critério do motor (parseListaInscritos): DDD + número vira +55.
function arE164(tel) {
  const d = String(tel || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return '+55' + d;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return '+' + d;
  return null;
}

function arDias(inicio, fim, hIni, hFim, pausas) {
  const dias = [];
  const d = new Date(`${inicio}T12:00:00`), ate = new Date(`${fim || inicio}T12:00:00`);
  while (d <= ate && dias.length < 7) {
    dias.push({ data: d.toISOString().slice(0, 10), inicio: hIni, fim: hFim, pausas: arClone(pausas) });
    d.setDate(d.getDate() + 1);
  }
  return dias;
}

function arRegrasPadrao(camp) {
  return {
    dias: camp?.data_inicio ? arDias(camp.data_inicio, camp.data_fim, '08:00', '20:00', [{ inicio: '12:00', fim: '13:00' }]) : [],
    tolerancia_wo_min: 10, descanso_min: 15, duracao_media_min: 35, intervalo_min: 5,
    desistencia_modo: 'anular', wo_conta_saldo: true, cruzamento: 'melhores2', preset: 'A',
    pix: null, whatsapp: '', regulamento: '',
  };
}
const arRegras = () => ({ ...arRegrasPadrao(ARENA.c?.camp), ...(ARENA.c?.camp?.regras || {}) });
const arFormato = cat => ({ ...AR_FORMATO_PADRAO, ...(cat?.formato || {}) });

// ── Acesso a dados: Supabase (contrato) ou demo ──────────
// Recusas com texto fixo no painel, independente da mensagem do banco (docs/ARENA.md, tabela de hints).
const AR_HINTS = {
  proxima_encerrada: 'A partida seguinte do mata-mata já terminou. Corrija ou anule a partida seguinte antes de mudar este resultado.',
  proxima_iniciada: 'A partida seguinte já começou: só o gestor pode corrigir, usando "forçar".',
  atleta_ja_inscrito: 'Atleta já inscrito em outra dupla desta categoria.',
  sem_permissao: 'Seu papel nesta arena não permite essa ação.',
};

// Erros do Postgres/PostgREST sem hint (constraints, RLS, rede) viram texto em português.
function arMensagemBanco(e) {
  const msg = String(e?.message || '');
  const det = `${msg} ${e?.details || ''}`.toLowerCase();
  if (e?.code === '23505') {
    if (det.includes('telefone')) return 'Já existe um atleta com esse telefone nesta arena.';
    if (det.includes('slug')) return 'Esse endereço público já está em uso. Escolha outro.';
    if (det.includes('token')) return 'Não foi possível gerar o link. Tente de novo.';
    return 'Esse registro já existe.';
  }
  if (e?.code === '23503') return 'Este registro está em uso por outro e não pode ser removido ou alterado.';
  if (e?.code === '23514' || e?.code === '22P02' || e?.code === '22007') return 'Algum dado está fora do formato aceito. Confira os campos.';
  if (e?.code === '42501') return AR_HINTS.sem_permissao;
  if (e?.code === 'PGRST116') return 'Registro não encontrado ou sem permissão para alterá-lo.';
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
  if (/jwt|token is expired/i.test(msg)) return 'Sua sessão expirou. Entre de novo.';
  return msg || 'Erro inesperado';
}

function arErro(e) {
  const err = new Error(AR_HINTS[e?.hint] || (e?.hint ? e.message : arMensagemBanco(e)));
  err.hint = e?.hint;
  return err;
}

// Netlify Function com o login do gestor (Authorization: Bearer).
async function arFuncao(nome, payload) {
  const { data } = await SUPA.auth.getSession();
  const r = await fetch(`/.netlify/functions/${nome}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data?.session?.access_token || ''}` },
    body: JSON.stringify(payload),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Erro ${r.status}`);
  return j;
}

// teams: colunas explícitas, porque o select de teams não tem acompanhamento_token (grant por coluna, 006).
const AR_COLUNAS = {
  teams: 'id,category_id,athlete1_id,athlete2_id,status,pagamento,pago_em,seed,origem,presente1,presente2,desistente_em,' +
    'observacao,created_at,updated_at,comprovante_path,comprovante_enviado_em,comprovante_status,comprovante_motivo,comprovante_envios,tabela_email_em',
};
const arColunas = tabela => AR_COLUNAS[tabela] || '*';

const ARENA_REAL = {
  async select(tabela, filtro = {}, ordem, signal) {
    let q = SUPA.from(tabela).select(arColunas(tabela));
    for (const [k, v] of Object.entries(filtro)) q = Array.isArray(v) ? q.in(k, v) : q.eq(k, v);
    if (ordem) q = q.order(ordem);
    if (signal) q = q.abortSignal(signal);
    const { data, error } = await q;
    if (error) throw arErro(error);
    return data || [];
  },
  async insert(tabela, linha) {
    const { data, error } = await SUPA.from(tabela).insert(linha).select(arColunas(tabela)).single();
    if (error) throw arErro(error);
    return data;
  },
  async update(tabela, id, patch) {
    const { data, error } = await SUPA.from(tabela).update(patch).eq('id', id).select(arColunas(tabela)).single();
    if (error) throw arErro(error);
    return data;
  },
  async remove(tabela, id) {
    const { error } = await SUPA.from(tabela).delete().eq('id', id);
    if (error) throw arErro(error);
  },
  async rpc(nome, args) {
    const { data, error } = await SUPA.rpc(nome, args);
    if (error) throw arErro(error);
    return data;
  },
  membro(payload) { return arFuncao('arena-member', payload); },
  pagamento(payload) { return arFuncao('arena-pagamento', payload); },
  notificar(payload) { return arFuncao('arena-notificar', payload); },
  async minhasArenas() {
    const uid = SUPA_USER?.id;
    if (!uid) return [];
    if (typeof currentAccess === 'function' && currentAccess()?.isAdmin) {
      const { data, error } = await SUPA.from('arenas').select('*').order('nome');
      if (error) throw arErro(error);
      return (data || []).map(arena => ({ arena, papel: 'admin' }));
    }
    const { data, error } = await SUPA.from('arena_members').select('papel, arena:arenas(*)').eq('user_id', uid).eq('ativo', true);
    if (error) throw arErro(error);
    return (data || []).filter(m => m.arena).map(m => ({ arena: m.arena, papel: m.papel }));
  },
};

const arenaDb = () => (arenaPainelDemo() ? ARENA_DEMO : ARENA_REAL);

// ── Entrada: menu, rota /arena e checagem de membro ──────
function isArenaMember() {
  if (arenaPainelDemo()) return true;
  const uid = typeof SUPA_USER !== 'undefined' ? SUPA_USER?.id : null;
  if (!uid || !SUPA) return false;
  if (ARENA_MEMBROS.uid !== uid) {
    ARENA_MEMBROS = { uid, lista: [] };
    ARENA_REAL.minhasArenas()
      .then(lista => {
        if (ARENA_MEMBROS.uid !== uid) return;
        ARENA_MEMBROS.lista = lista;
        // Quem só é scout abre direto no /scout ao entrar no app (plano, seção 3).
        const especial = arenaRoute() || (typeof isAdminRoute === 'function' && isAdminRoute())
          || (typeof isResetPasswordRoute === 'function' && isResetPasswordRoute());
        const admin = typeof currentAccess === 'function' && currentAccess()?.isAdmin; // buildUserMenu roda depois do refreshAccess
        if (lista.length && lista.every(m => m.papel === 'scout') && !especial && !admin) {
          location.replace('/scout');
          return;
        }
        if (lista.length && SUPA_USER) buildUserMenu(SUPA_USER);
      })
      .catch(() => {}); // sem a migração 004 a consulta falha: o item simplesmente não aparece
  }
  return ARENA_MEMBROS.lista.length > 0;
}

function openMinhaArena() {
  closeUserMenu();
  const l = ARENA_MEMBROS.lista;
  if (!arenaPainelDemo() && l.length && l.every(m => m.papel === 'scout')) { location.href = '/scout'; return; }
  goTo('screen-arena');
  arenaIniciar();
}

function openArenaRoute() {
  arenaIniciar();
}

function arenaSair() {
  if (APP.history.length > 1) goBack();
  else location.href = '/';
}

async function arEsperarSessao() {
  for (let i = 0; i < 50 && !SUPA; i++) await new Promise(r => setTimeout(r, 100));
  if (!SUPA) return;
  const { data } = await SUPA.auth.getSession();
  if (!SUPA_USER) SUPA_USER = data?.session?.user || null;
}

async function arenaIniciar() {
  arScreen('screen-arena', 'Minha arena', '<div class="ar-vazio">Carregando...</div>', { voltar: 'arenaSair()' });
  if (!arenaPainelDemo()) {
    await arEsperarSessao();
    if (!SUPA_USER) {
      return arScreen('screen-arena', 'Minha arena', `
        <div class="ar-card ar-centro">
          <div class="ar-h">Entre na sua conta</div>
          <p class="ar-txt">O painel da arena é só para a equipe cadastrada pelo gestor.</p>
          <button class="btn btn-yellow" onclick="openAuthModal('login')">${icon('user')} Entrar</button>
        </div>`, { voltar: 'arenaSair()' });
    }
  }
  try {
    ARENA_MEMBROS.lista = await arenaDb().minhasArenas();
    // Scout não lê athletes (LGPD): o painel lista só as arenas em que a pessoa é dono, gestor ou árbitro.
    ARENA.arenas = ARENA_MEMBROS.lista.filter(m => m.papel !== 'scout');
  } catch (e) {
    return arScreen('screen-arena', 'Minha arena', `<div class="ar-card"><div class="ar-alerta">${icon('alert')} Não foi possível carregar suas arenas. ${arEsc(e.message)}</div></div>`, { voltar: 'arenaSair()' });
  }
  if (!ARENA.arenas.length) {
    if (ARENA_MEMBROS.lista.length) { location.href = '/scout'; return; }
    return arScreen('screen-arena', 'Minha arena', '<div class="ar-card ar-centro"><p class="ar-txt">Você ainda não faz parte de nenhuma arena. Fale com o BT8 para criar a sua.</p></div>', { voltar: 'arenaSair()' });
  }
  const atual = ARENA.arena && ARENA.arenas.find(m => m.arena.id === ARENA.arena.id);
  await arenaEscolher((atual || ARENA.arenas[0]).arena.id);
}

async function arenaEscolher(id) {
  const m = ARENA.arenas.find(x => x.arena.id === id);
  if (!m) return;
  ARENA.arena = m.arena;
  ARENA.papel = m.papel;
  await arenaCarregarHome();
}

async function arenaCarregarHome() {
  const db = arenaDb(), a = ARENA.arena;
  try {
    [ARENA.camps, ARENA.quadras, ARENA.membros] = await Promise.all([
      db.select('championships', { arena_id: a.id }, 'data_inicio'),
      db.select('courts', { arena_id: a.id }, 'ordem'),
      db.select('arena_members', { arena_id: a.id }, 'nome'),
    ]);
  } catch (e) {
    return arToast(e.message, 'erro');
  }
  arenaRenderHome();
}

// ── Componentes de tela ──────────────────────────────────
function arScreen(id, titulo, corpo, { voltar = 'goBack()' } = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  const scroll = el.querySelector('.scroll-content')?.scrollTop || 0;
  el.innerHTML = `
    <div class="bg-mesh"></div>
    <div class="topbar">
      <button class="back-btn" onclick="${voltar}" aria-label="Voltar">‹</button>
      <span class="topbar-title">${arEsc(titulo)}</span>
    </div>
    <div class="scroll-content"><div class="ar-wrap">
      ${arenaPainelDemo() ? '<div class="ar-demo">Modo demonstração: dados simulados neste navegador, nada vai para o banco. <button class="ar-link-btn" onclick="arenaDemoReset()">Recomeçar demo</button></div>' : ''}
      ${corpo}
    </div></div>`;
  el.querySelector('.scroll-content').scrollTop = scroll;
}

function arTabs(itens, ativo, fn) {
  return `<div class="ar-tabs" role="tablist">${itens.map(([id, rot]) =>
    `<button class="ar-tab" role="tab" aria-selected="${id === ativo}" onclick="${fn}('${arEsc(id)}')">${arEsc(rot)}</button>`).join('')}</div>`;
}

function arChip(txt, tipo = '') {
  return `<span class="ar-chip ${tipo}">${arEsc(txt)}</span>`;
}

function arToast(msg, tipo = 'ok') {
  let t = document.getElementById('ar-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'ar-toast';
    t.setAttribute('role', 'status');
    document.body.appendChild(t);
  }
  t.className = `ar-toast ${tipo} show`;
  t.textContent = msg;
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), tipo === 'erro' ? 6000 : 3500);
}

async function arAcao(fn, ok) {
  try {
    await fn();
    if (ok) arToast(ok);
  } catch (e) {
    console.warn('Arena:', e);
    arToast(e.message || 'Algo deu errado', 'erro');
  }
}

function arCampo(c) {
  const id = 'arf-' + c.nome;
  const v = c.valor ?? '';
  const cls = `ar-field${c.meio ? ' meio' : ''}`;
  if (c.tipo === 'checkbox') return `<label class="ar-check ${c.meio ? 'meio' : ''}"><input type="checkbox" name="${c.nome}" ${v ? 'checked' : ''}> <span>${arEsc(c.rotulo)}</span></label>`;
  if (c.tipo === 'radio') {
    return `<fieldset class="ar-field ar-radios"><legend>${arEsc(c.rotulo)}</legend>${c.opcoes.map(([val, rot, ajuda]) =>
      `<label class="ar-radio"><input type="radio" name="${c.nome}" value="${arEsc(val)}" ${String(val) === String(v) ? 'checked' : ''}><span>${arEsc(rot)}${ajuda ? `<small>${arEsc(ajuda)}</small>` : ''}</span></label>`).join('')}</fieldset>`;
  }
  let campo;
  if (c.tipo === 'select') {
    campo = `<select class="input-field" id="${id}" name="${c.nome}">${c.opcoes.map(([val, rot]) =>
      `<option value="${arEsc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${arEsc(rot)}</option>`).join('')}</select>`;
  } else if (c.tipo === 'textarea') {
    campo = `<textarea class="input-field" id="${id}" name="${c.nome}" rows="${c.linhas || 5}" placeholder="${arEsc(c.placeholder || '')}">${arEsc(v)}</textarea>`;
  } else {
    campo = `<input class="input-field" id="${id}" name="${c.nome}" type="${c.tipo || 'text'}" value="${arEsc(v)}" placeholder="${arEsc(c.placeholder || '')}" ${c.extra || ''}>`;
  }
  return `<label class="${cls}" for="${id}"><span>${arEsc(c.rotulo)}</span>${campo}${c.ajuda ? `<small>${arEsc(c.ajuda)}</small>` : ''}</label>`;
}

// Modal genérico: devolve os valores dos campos, ou null se cancelar. `texto` é HTML já escapado.
function arForm({ titulo, texto = '', campos = [], ok = 'Salvar', perigo = false }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'ar-modal';
    wrap.innerHTML = `
      <form class="ar-modal-box" role="dialog" aria-modal="true" aria-labelledby="ar-modal-t" novalidate>
        <div class="ar-modal-t" id="ar-modal-t">${arEsc(titulo)}</div>
        ${texto ? `<div class="ar-modal-txt">${texto}</div>` : ''}
        ${campos.length ? `<div class="ar-campos">${campos.map(arCampo).join('')}</div>` : ''}
        <div class="ar-modal-msg" role="alert"></div>
        <div class="ar-modal-acoes">
          <button type="button" class="btn btn-ghost btn-sm" data-x>Cancelar</button>
          <button type="submit" class="btn ${perigo ? 'btn-coral' : 'btn-yellow'} btn-sm">${arEsc(ok)}</button>
        </div>
      </form>`;
    const anterior = document.activeElement;
    const fechar = v => { wrap.remove(); anterior?.focus?.(); resolve(v); };
    wrap.querySelector('[data-x]').onclick = () => fechar(null);
    wrap.addEventListener('click', e => { if (e.target === wrap) fechar(null); });
    wrap.addEventListener('keydown', e => { if (e.key === 'Escape') fechar(null); });
    wrap.querySelector('form').onsubmit = e => {
      e.preventDefault();
      const v = {};
      for (const c of campos) {
        const el = wrap.querySelector(`[name="${c.nome}"]`);
        v[c.nome] = c.tipo === 'checkbox' ? el.checked
          : c.tipo === 'radio' ? (wrap.querySelector(`[name="${c.nome}"]:checked`)?.value || '') : el.value.trim();
        if (c.obrigatorio && !v[c.nome]) {
          wrap.querySelector('.ar-modal-msg').textContent = c.tipo === 'checkbox' ? 'Marque a confirmação para continuar.'
            : c.tipo === 'radio' ? `Escolha uma opção em "${c.rotulo}".` : `Preencha: ${c.rotulo}`;
          el.focus();
          return;
        }
      }
      fechar(v);
    };
    document.body.appendChild(wrap);
    (wrap.querySelector('input:not([type=checkbox]),select,textarea') || wrap.querySelector('[type=submit]')).focus();
  });
}

const arConfirm = (titulo, texto, ok = 'Confirmar', perigo = false) => arForm({ titulo, texto, ok, perigo }).then(v => !!v);

// ══ MINHA ARENA: campeonatos, quadras e equipe ═══════════
function arenaRenderHome() {
  const a = ARENA.arena;
  const seletor = ARENA.arenas.length > 1
    ? `<select class="input-field ar-seletor" aria-label="Trocar de arena" onchange="arenaEscolher(this.value)">${ARENA.arenas.map(m =>
      `<option value="${m.arena.id}" ${m.arena.id === a.id ? 'selected' : ''}>${arEsc(m.arena.nome)}</option>`).join('')}</select>`
    : '';
  const corpo = { campeonatos: arenaCampsHtml, quadras: arenaQuadrasHtml, equipe: arenaEquipeHtml }[ARENA.tab]();
  arScreen('screen-arena', 'Minha arena', `
    <div class="ar-cab">
      <div>
        <div class="ar-titulo">${arEsc(a.nome)}</div>
        <div class="ar-sub">${arEsc([a.cidade, a.estado].filter(Boolean).join(' - '))} · ${arEsc(AR_PAPEL[ARENA.papel] || ARENA.papel)}</div>
      </div>
      ${seletor}
    </div>
    ${arTabs([['campeonatos', 'Campeonatos'], ['quadras', 'Quadras'], ['equipe', 'Equipe']], ARENA.tab, 'arenaTab')}
    ${corpo}`, { voltar: 'arenaSair()' });
}

function arenaTab(tab) {
  ARENA.tab = tab;
  arenaRenderHome();
}

function arenaCampsHtml() {
  const lista = ARENA.camps.map(c => `
    <button class="ar-row ar-row-btn" onclick="arenaAbrirCamp('${c.id}')">
      <span class="ar-row-main"><b>${arEsc(c.titulo)}</b><small>${arData(c.data_inicio)} a ${arData(c.data_fim)}</small></span>
      ${arChip(AR_STATUS_CAMP[c.status] || c.status, c.status === 'inscricoes' || c.status === 'em_andamento' ? 'ok' : 'mute')}
      <span class="ar-seta" aria-hidden="true">›</span>
    </button>`).join('');
  return `
    <div class="ar-card">
      <div class="ar-card-h"><div class="ar-h">${icon('trophy')} Campeonatos</div>
        ${arG() ? `<button class="btn btn-yellow btn-sm" onclick="arenaNovoCamp()">${icon('plus')} Novo</button>` : ''}</div>
      <div class="ar-list">${lista || '<div class="ar-vazio">Nenhum campeonato ainda.</div>'}</div>
    </div>`;
}

async function arenaNovoCamp() {
  const v = await arForm({
    titulo: 'Novo campeonato',
    campos: [
      { nome: 'titulo', rotulo: 'Título', obrigatorio: true, placeholder: 'Open de Verão 2026' },
      { nome: 'data_inicio', rotulo: 'Primeiro dia', tipo: 'date', obrigatorio: true, meio: true },
      { nome: 'data_fim', rotulo: 'Último dia', tipo: 'date', obrigatorio: true, meio: true },
    ],
    ok: 'Criar',
  });
  if (!v) return;
  if (v.data_fim < v.data_inicio) return arToast('O último dia não pode ser antes do primeiro.', 'erro');
  await arAcao(async () => {
    const camp = { arena_id: ARENA.arena.id, titulo: v.titulo, slug: arSlug(`${v.titulo}-${ARENA.arena.slug || ''}`), data_inicio: v.data_inicio, data_fim: v.data_fim, status: 'rascunho', inscricao_token: arToken() };
    camp.regras = arRegrasPadrao(camp);
    const novo = await arenaDb().insert('championships', camp);
    ARENA.camps.push(novo);
    await arenaAbrirCamp(novo.id);
  }, 'Campeonato criado.');
}

function arenaQuadrasHtml() {
  const lista = ARENA.quadras.map(q => `
    <div class="ar-row">
      <span class="ar-row-main"><b>${arEsc(q.nome)}</b></span>
      ${arChip(q.ativa === false ? 'Inativa' : 'Ativa', q.ativa === false ? 'mute' : 'ok')}
      ${arG() ? `<span class="ar-acoes-inline">
        <button class="btn btn-ghost btn-sm" onclick="arenaEditarQuadra('${q.id}')" aria-label="Renomear ${arEsc(q.nome)}">${icon('pencil')}</button>
        <button class="btn btn-ghost btn-sm" onclick="arenaAtivarQuadra('${q.id}')">${q.ativa === false ? 'Ativar' : 'Desativar'}</button>
      </span>` : ''}
    </div>`).join('');
  return `
    <div class="ar-card">
      <div class="ar-card-h"><div class="ar-h">${icon('ball')} Quadras</div>
        ${arG() ? `<button class="btn btn-yellow btn-sm" onclick="arenaNovaQuadra()">${icon('plus')} Adicionar</button>` : ''}</div>
      <div class="ar-list">${lista || '<div class="ar-vazio">Cadastre as quadras para a conta de capacidade e a Mesa.</div>'}</div>
    </div>`;
}

async function arenaNovaQuadra() {
  const v = await arForm({ titulo: 'Nova quadra', campos: [{ nome: 'nome', rotulo: 'Nome', obrigatorio: true, valor: `Quadra ${ARENA.quadras.length + 1}` }], ok: 'Adicionar' });
  if (!v) return;
  await arAcao(async () => {
    const ordem = Math.max(0, ...ARENA.quadras.map(q => q.ordem || 0)) + 1;
    ARENA.quadras.push(await arenaDb().insert('courts', { arena_id: ARENA.arena.id, nome: v.nome, ordem, ativa: true }));
    arenaRenderHome();
  }, 'Quadra adicionada.');
}

async function arenaEditarQuadra(id) {
  const q = ARENA.quadras.find(x => x.id === id);
  const v = await arForm({ titulo: 'Renomear quadra', campos: [{ nome: 'nome', rotulo: 'Nome', obrigatorio: true, valor: q.nome }] });
  if (!v) return;
  await arAcao(async () => {
    Object.assign(q, await arenaDb().update('courts', id, { nome: v.nome }));
    arenaRenderHome();
  }, 'Quadra salva.');
}

async function arenaAtivarQuadra(id) {
  const q = ARENA.quadras.find(x => x.id === id);
  await arAcao(async () => {
    Object.assign(q, await arenaDb().update('courts', id, { ativa: q.ativa === false }));
    arenaRenderHome();
  });
}

function arenaEquipeHtml() {
  const g = arG();
  const lista = ARENA.membros.map(m => {
    const editavel = g && m.papel !== 'dono' && m.user_id !== SUPA_USER?.id;
    return `
    <div class="ar-row">
      <span class="ar-row-main"><b>${arEsc(m.nome)}</b><small>${arEsc(m.email || 'sem app (só registro)')}</small></span>
      ${editavel
        ? `<select class="input-field ar-mini" aria-label="Papel de ${arEsc(m.nome)}" onchange="arenaPapelMembro('${m.id}', this.value)">${['gestor', 'arbitro', 'scout'].map(p =>
          `<option value="${p}" ${m.papel === p ? 'selected' : ''}>${AR_PAPEL[p]}</option>`).join('')}</select>
          <button class="btn btn-ghost btn-sm" onclick="arenaAtivarMembro('${m.id}')">${m.ativo === false ? 'Reativar' : 'Desativar'}</button>`
        : arChip(AR_PAPEL[m.papel] || m.papel, m.papel === 'dono' ? 'ok' : '')}
      ${m.ativo === false ? arChip('Inativo', 'mute') : ''}
    </div>`;
  }).join('');
  return `
    <div class="ar-card">
      <div class="ar-card-h"><div class="ar-h">${icon('users')} Equipe</div>
        ${g ? `<button class="btn btn-yellow btn-sm" onclick="arenaNovoMembro()">${icon('plus')} Adicionar</button>` : ''}</div>
      <p class="ar-txt">O scout só marca games; o árbitro também chama, suspende, aplica WO e corrige placar. Entregue o login pessoalmente.</p>
      <div class="ar-list">${lista || '<div class="ar-vazio">Ninguém na equipe ainda.</div>'}</div>
    </div>`;
}

async function arenaNovoMembro() {
  const v = await arForm({
    titulo: 'Adicionar à equipe',
    campos: [
      { nome: 'nome', rotulo: 'Nome', obrigatorio: true },
      { nome: 'papel', rotulo: 'Papel', tipo: 'select', valor: 'scout', opcoes: [['scout', 'Scout'], ['arbitro', 'Árbitro'], ['gestor', 'Gestor']] },
      { nome: 'email', rotulo: 'E-mail', tipo: 'email', extra: 'autocomplete="off"' },
      { nome: 'senha', rotulo: 'Senha inicial (8 ou mais caracteres)', tipo: 'text', extra: 'autocomplete="new-password"', ajuda: 'Se o e-mail já tem conta no BT8, a senha é ignorada e a conta é vinculada.' },
      { nome: 'sem_conta', rotulo: 'Árbitro sem app (só o nome, para registro)', tipo: 'checkbox' },
    ],
    ok: 'Adicionar',
  });
  if (!v) return;
  const payload = { acao: 'criar', arena_id: ARENA.arena.id, nome: v.nome, papel: v.papel };
  if (v.sem_conta) {
    if (v.papel !== 'arbitro') return arToast('Só o árbitro pode ficar sem app.', 'erro');
    payload.sem_conta = true;
  } else {
    if (!/^\S+@\S+\.\S+$/.test(v.email)) return arToast('Informe um e-mail válido.', 'erro');
    Object.assign(payload, { email: v.email.toLowerCase(), senha: v.senha });
  }
  await arAcao(async () => {
    const r = await arenaDb().membro(payload);
    await arenaCarregarHome();
    arToast(r.conta_criada ? 'Conta criada e vinculada. Entregue o login pessoalmente.' : 'Adicionado à equipe.');
  });
}

async function arenaPapelMembro(id, papel) {
  await arAcao(async () => {
    await arenaDb().membro({ acao: 'atualizar', arena_id: ARENA.arena.id, member_id: id, papel });
    await arenaCarregarHome();
  }, 'Papel atualizado.');
}

async function arenaAtivarMembro(id) {
  const m = ARENA.membros.find(x => x.id === id);
  await arAcao(async () => {
    await arenaDb().membro({ acao: 'atualizar', arena_id: ARENA.arena.id, member_id: id, ativo: m.ativo === false });
    await arenaCarregarHome();
  });
}

// ══ CAMPEONATO ═══════════════════════════════════════════
async function arenaCarregarCamp(id) {
  const db = arenaDb();
  const camp = (await db.select('championships', { id }))[0];
  if (!camp) throw new Error('Campeonato não encontrado.');
  const cats = await db.select('categories', { championship_id: id }, 'ordem');
  const catIds = cats.map(c => c.id);
  const [teams, athletes, groups, matches] = await Promise.all([
    catIds.length ? db.select('teams', { category_id: catIds }) : [],
    db.select('athletes', { arena_id: ARENA.arena.id }),
    catIds.length ? db.select('category_groups', { category_id: catIds }, 'ordem') : [],
    db.select('matches', { championship_id: id }),
  ]);
  const groupTeams = groups.length ? await db.select('group_teams', { group_id: groups.map(g => g.id) }) : [];
  ARENA.c = { camp, cats, teams, athletes, groups, groupTeams, matches, atl: Object.fromEntries(athletes.map(a => [a.id, a])) };
  if (!cats.some(c => c.id === ARENA.catId)) ARENA.catId = cats[0]?.id || null;
}

async function arenaAbrirCamp(id) {
  try {
    await arenaCarregarCamp(id);
  } catch (e) {
    return arToast(e.message, 'erro');
  }
  goTo('screen-arena-campeonato');
  arenaRenderCamp();
}

const arDupla = t => (t ? `${ARENA.c.atl[t.athlete1_id]?.nome || '?'} / ${ARENA.c.atl[t.athlete2_id]?.nome || '?'}` : '-');
const arTeam = id => ARENA.c.teams.find(t => t.id === id);
const arTeamsCat = catId => ARENA.c.teams.filter(t => t.category_id === catId);
const arGruposCat = catId => ARENA.c.groups.filter(g => g.category_id === catId);
const arLink = (caminho) => `${location.origin}${caminho}`;

function arenaRenderCamp() {
  const { camp, cats } = ARENA.c;
  const R = arRegras();
  const g = arG();
  const linkInsc = arLink(`/inscricao/${camp.inscricao_token}`);
  const catsHtml = cats.map(c => {
    const f = arFormato(c);
    const ativas = arTeamsCat(c.id).filter(arAtiva).length;
    return `
      <div class="ar-row">
        <span class="ar-row-main"><b>${arEsc(c.nome)}</b>
          <small>${ativas}/${c.max_duplas || '∞'} duplas · classificam ${f.classificam} · preset ${arEsc(f.preset_grupo)}/${arEsc(f.preset_mata)}${c.genero ? ' · ' + arEsc(c.genero) : ''}</small></span>
        ${c.inscricoes_abertas === false ? arChip('Inscrição fechada', 'mute') : ''}
        ${g ? `<span class="ar-acoes-inline">
          <button class="btn btn-ghost btn-sm" onclick="arenaEditarCat('${c.id}')" aria-label="Editar ${arEsc(c.nome)}">${icon('pencil')}</button>
          <button class="btn btn-ghost btn-sm" onclick="arenaRemoverCat('${c.id}')">Remover</button></span>` : ''}
      </div>`;
  }).join('');
  const dia = (R.dias || [])[0];
  arScreen('screen-arena-campeonato', 'Campeonato', `
    <div class="ar-cab">
      <div>
        <div class="ar-titulo">${arEsc(camp.titulo)}</div>
        <div class="ar-sub">${arData(camp.data_inicio)} a ${arData(camp.data_fim)} · /c/${arEsc(camp.slug)}</div>
      </div>
      ${g ? `<select class="input-field ar-seletor" aria-label="Status do campeonato" onchange="arenaStatusCamp(this.value)">${Object.entries(AR_STATUS_CAMP).map(([k, v]) =>
        `<option value="${k}" ${camp.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>` : arChip(AR_STATUS_CAMP[camp.status])}
    </div>

    <div class="ar-nav">
      <button class="ar-nav-btn" onclick="arenaAbrirInscritos()">${icon('users')}<b>Inscritos</b><small>${ARENA.c.teams.filter(arAtiva).length} duplas</small></button>
      <button class="ar-nav-btn" onclick="arenaAbrirSorteio()">${icon('dices')}<b>Sorteio</b><small>${ARENA.c.groups.length ? 'publicado' : 'grupos'}</small></button>
      <button class="ar-nav-btn" onclick="arenaAbrirChave()">${icon('trophy')}<b>Grupos e chave</b><small>classificação</small></button>
      <button class="ar-nav-btn" onclick="mesaAbrir()">${icon('zap')}<b>Mesa</b><small>quadras ao vivo</small></button>
      <button class="ar-nav-btn" onclick="credAbrir()">${icon('check')}<b>Credenciamento</b><small>presença</small></button>
      <button class="ar-nav-btn" onclick="mesaExportar()">${icon('download')}<b>Exportar</b><small>JSON, CSV, imprimir</small></button>
    </div>

    <div class="ar-grid2">
      <div class="ar-card">
        <div class="ar-card-h"><div class="ar-h">Dados</div>${g ? `<button class="btn btn-ghost btn-sm" onclick="arenaEditarCamp()">${icon('pencil')} Editar</button>` : ''}</div>
        <dl class="ar-dl">
          <dt>Datas</dt><dd>${arData(camp.data_inicio)} a ${arData(camp.data_fim)}</dd>
          <dt>Inscrições até</dt><dd>${arData(arDiaSP(camp.inscricoes_ate))}</dd>
          <dt>Endereço público</dt><dd>/c/${arEsc(camp.slug)}</dd>
        </dl>
      </div>

      <div class="ar-card">
        <div class="ar-card-h"><div class="ar-h">Link de inscrição</div></div>
        <div class="ar-url">${arEsc(linkInsc)}</div>
        ${camp.status !== 'inscricoes' ? `<p class="ar-txt ar-aviso">${icon('alert')} O link só aceita inscrições com o status "Inscrições abertas".</p>` : ''}
        <div class="ar-botoes">
          <button class="btn btn-yellow btn-sm" onclick="arenaCopiar('${arEsc(linkInsc)}')">${icon('share')} Copiar link</button>
          ${g ? `<button class="btn btn-ghost btn-sm" onclick="arenaTrocarToken()">${icon('refresh')} Trocar link</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="arenaCopiar('${arEsc(arLink('/c/' + camp.slug))}')">Página pública</button>
          <button class="btn btn-ghost btn-sm" onclick="arenaCopiar('${arEsc(arLink('/telao/' + camp.slug))}')">Telão</button>
        </div>
      </div>
    </div>

    <div class="ar-card">
      <div class="ar-card-h"><div class="ar-h">Regras</div>${g ? `<button class="btn btn-ghost btn-sm" onclick="arenaEditarRegras()">${icon('pencil')} Editar</button>` : ''}</div>
      <dl class="ar-dl ar-dl2">
        <dt>Horário</dt><dd>${dia ? `${arEsc(dia.inicio)} às ${arEsc(dia.fim)}${dia.pausas?.[0] ? `, pausa ${arEsc(dia.pausas[0].inicio)}-${arEsc(dia.pausas[0].fim)}` : ''}` : '-'} (${(R.dias || []).length} dia(s))</dd>
        <dt>Jogo</dt><dd>Preset ${arEsc(R.preset)} · ${R.duracao_media_min} min + ${R.intervalo_min} min</dd>
        <dt>Tolerância de WO</dt><dd>${R.tolerancia_wo_min} min</dd>
        <dt>Descanso mínimo</dt><dd>${R.descanso_min} min</dd>
        <dt>Desistência</dt><dd>${R.desistencia_modo === 'manter_wo' ? 'mantém os jogos feitos e WO no restante' : 'anula todos os jogos da dupla'}</dd>
        <dt>WO no saldo</dt><dd>${R.wo_conta_saldo === false ? 'não conta (só a vitória)' : 'conta 6x0'}</dd>
        <dt>Cruzamento</dt><dd>1º x 2º de outro grupo; com 3, 5, 6 ou 7 grupos, melhores 2ºs</dd>
        <dt>Pix</dt><dd>${R.pix?.chave ? `${arEsc(R.pix.chave)} · R$ ${Number(R.pix.valor || 0).toFixed(2).replace('.', ',')}` : 'sem pagamento'}</dd>
        <dt>WhatsApp</dt><dd>${arEsc(R.whatsapp || '-')}</dd>
      </dl>
    </div>

    <div class="ar-card">
      <div class="ar-card-h"><div class="ar-h">Regulamento resumido</div>
        ${g ? `<span class="ar-acoes-inline"><button class="btn btn-ghost btn-sm" onclick="arenaGerarRegulamento()">Gerar das regras</button>
        <button class="btn btn-ghost btn-sm" onclick="arenaEditarRegulamento()">${icon('pencil')} Editar</button></span>` : ''}</div>
      ${R.regulamento ? `<div class="ar-regulamento">${arEsc(R.regulamento)}</div>` : '<div class="ar-vazio">Ainda sem regulamento. Ele aparece na página pública antes de abrir as inscrições.</div>'}
    </div>

    <div class="ar-card">
      <div class="ar-card-h"><div class="ar-h">Categorias</div>${g ? `<button class="btn btn-yellow btn-sm" onclick="arenaEditarCat()">${icon('plus')} Nova</button>` : ''}</div>
      <div class="ar-list">${catsHtml || '<div class="ar-vazio">Crie as categorias (ex.: Masculino B, Feminina C).</div>'}</div>
    </div>

    ${arenaCapacidadeHtml()}`);
}

async function arenaSalvarCamp(patch, ok) {
  await arAcao(async () => {
    ARENA.c.camp = await arenaDb().update('championships', ARENA.c.camp.id, patch);
    const i = ARENA.camps.findIndex(c => c.id === ARENA.c.camp.id);
    if (i >= 0) ARENA.camps[i] = ARENA.c.camp;
  }, ok);
  arenaRenderCamp(); // também em caso de erro: os campos voltam ao valor gravado
}

async function arenaStatusCamp(status) {
  const semRegulamento = status === 'inscricoes' && !arRegras().regulamento;
  const ok = await arConfirm('Mudar status', `Mudar o campeonato de <b>${arEsc(AR_STATUS_CAMP[ARENA.c.camp.status])}</b> para <b>${arEsc(AR_STATUS_CAMP[status])}</b>?
    ${semRegulamento ? `<p class="ar-aviso">${icon('alert')} O regulamento resumido ainda não foi publicado.</p>` : ''}`, 'Mudar');
  if (!ok) return arenaRenderCamp();
  arenaSalvarCamp({ status }, 'Status atualizado.');
}

async function arenaEditarCamp() {
  const c = ARENA.c.camp;
  const v = await arForm({
    titulo: 'Dados do campeonato',
    campos: [
      { nome: 'titulo', rotulo: 'Título', obrigatorio: true, valor: c.titulo },
      { nome: 'slug', rotulo: 'Endereço público (/c/...)', obrigatorio: true, valor: c.slug },
      { nome: 'data_inicio', rotulo: 'Primeiro dia', tipo: 'date', obrigatorio: true, valor: c.data_inicio, meio: true },
      { nome: 'data_fim', rotulo: 'Último dia', tipo: 'date', obrigatorio: true, valor: c.data_fim, meio: true },
      { nome: 'inscricoes_ate', rotulo: 'Inscrições até', tipo: 'date', valor: arDiaSP(c.inscricoes_ate) },
    ],
  });
  if (!v) return;
  if (v.data_fim < v.data_inicio) return arToast('O último dia não pode ser antes do primeiro.', 'erro');
  const R = arRegras();
  const dia = R.dias?.[0] || { inicio: '08:00', fim: '20:00', pausas: [] };
  const regras = { ...R, dias: arDias(v.data_inicio, v.data_fim, dia.inicio, dia.fim, dia.pausas || []) };
  arenaSalvarCamp({ titulo: v.titulo, slug: arSlug(v.slug), data_inicio: v.data_inicio, data_fim: v.data_fim, inscricoes_ate: v.inscricoes_ate ? `${v.inscricoes_ate}T23:59:00-03:00` : null, regras }, 'Dados salvos.');
}

async function arenaEditarRegras() {
  const R = arRegras();
  const dia = R.dias?.[0] || { inicio: '08:00', fim: '20:00', pausas: [] };
  const pausa = dia.pausas?.[0] || {};
  const v = await arForm({
    titulo: 'Regras do campeonato',
    campos: [
      { nome: 'inicio', rotulo: 'Início dos jogos', tipo: 'time', valor: dia.inicio, meio: true },
      { nome: 'fim', rotulo: 'Fim dos jogos', tipo: 'time', valor: dia.fim, meio: true },
      { nome: 'pausa_inicio', rotulo: 'Pausa (início)', tipo: 'time', valor: pausa.inicio || '', meio: true },
      { nome: 'pausa_fim', rotulo: 'Pausa (fim)', tipo: 'time', valor: pausa.fim || '', meio: true },
      { nome: 'duracao_media_min', rotulo: 'Duração média (min)', tipo: 'number', valor: R.duracao_media_min, meio: true, extra: 'min="10" max="120" inputmode="numeric"' },
      { nome: 'intervalo_min', rotulo: 'Intervalo entre jogos (min)', tipo: 'number', valor: R.intervalo_min, meio: true, extra: 'min="0" max="60" inputmode="numeric"' },
      { nome: 'tolerancia_wo_min', rotulo: 'Tolerância de WO (min)', tipo: 'number', valor: R.tolerancia_wo_min, meio: true, extra: 'min="0" max="60" inputmode="numeric"' },
      { nome: 'descanso_min', rotulo: 'Descanso mínimo (min)', tipo: 'number', valor: R.descanso_min, meio: true, extra: 'min="0" max="120" inputmode="numeric"' },
      { nome: 'preset', rotulo: 'Preset de jogo', tipo: 'select', valor: R.preset, meio: true, opcoes: [['A', 'A: até 6, tie-break no 6x6'], ['B', 'B (emergência): até 4']] },
      { nome: 'wo_conta_saldo', rotulo: 'WO no saldo', tipo: 'select', valor: R.wo_conta_saldo === false ? 'nao' : 'sim', meio: true, opcoes: [['sim', 'Conta 6x0'], ['nao', 'Não conta']] },
      { nome: 'desistencia_modo', rotulo: 'Desistência no meio do grupo', tipo: 'select', valor: R.desistencia_modo, opcoes: [['anular', 'Anular todos os jogos da dupla'], ['manter_wo', 'Manter os feitos e WO no restante']] },
      { nome: 'whatsapp', rotulo: 'WhatsApp da arena', tipo: 'tel', valor: R.whatsapp, placeholder: '(81) 99999-0000' },
      { nome: 'pix_chave', rotulo: 'Chave Pix (vazio = sem pagamento)', valor: R.pix?.chave || '' },
      { nome: 'pix_favorecido', rotulo: 'Favorecido', valor: R.pix?.favorecido || '', meio: true },
      { nome: 'pix_valor', rotulo: 'Valor por dupla (R$)', tipo: 'number', valor: R.pix?.valor ?? '', meio: true, extra: 'min="0" step="0.01" inputmode="decimal"' },
    ],
  });
  if (!v) return;
  const num = (x, padrao) => (Number.isFinite(+x) && x !== '' ? +x : padrao);
  if (v.whatsapp && !arE164(v.whatsapp)) return arToast('WhatsApp inválido: use DDD e número.', 'erro');
  if ((v.pausa_inicio && !v.pausa_fim) || (!v.pausa_inicio && v.pausa_fim)) return arToast('Informe o início e o fim da pausa.', 'erro');
  const c = ARENA.c.camp;
  const regras = {
    ...R,
    dias: arDias(c.data_inicio, c.data_fim, v.inicio || '08:00', v.fim || '20:00', v.pausa_inicio ? [{ inicio: v.pausa_inicio, fim: v.pausa_fim }] : []),
    duracao_media_min: num(v.duracao_media_min, 35), intervalo_min: num(v.intervalo_min, 5),
    tolerancia_wo_min: num(v.tolerancia_wo_min, 10), descanso_min: num(v.descanso_min, 15),
    preset: v.preset, wo_conta_saldo: v.wo_conta_saldo !== 'nao', desistencia_modo: v.desistencia_modo, cruzamento: 'melhores2',
    whatsapp: v.whatsapp ? arE164(v.whatsapp) : '',
    pix: v.pix_chave ? { chave: v.pix_chave, favorecido: v.pix_favorecido, valor: num(v.pix_valor, 0) } : null,
  };
  arenaSalvarCamp({ regras }, 'Regras salvas.');
}

function arRegulamentoGerado() {
  const R = arRegras();
  const alvo = R.preset === 'B' ? 4 : 6;
  return [
    `Jogos: 1 set até ${alvo} games, com tie-break a 7 pontos no ${alvo}x${alvo}${R.preset === 'B' ? ' (formato reduzido de emergência)' : ''}.`,
    'Grupos de 3 ou 4 duplas, sorteados com cabeças de chave. Classificam os primeiros de cada grupo, conforme a categoria.',
    'Desempate no grupo: 1) vitórias; 2) entre duas duplas, confronto direto; 3) entre três ou mais, saldo de games entre as empatadas, depois saldo de games no grupo, games pró e sorteio registrado. Se o empate cair para duas duplas, volta ao confronto direto.',
    `WO: tolerância de ${R.tolerancia_wo_min} minutos após a chamada. O WO vale ${alvo}x0 ${R.wo_conta_saldo === false ? 'e não entra no saldo (conta só a vitória)' : 'e entra no saldo'}. WO duplo anula a partida.`,
    `Desistência no meio do grupo: ${R.desistencia_modo === 'manter_wo' ? 'os jogos já feitos valem e os restantes contam como WO' : 'todos os jogos da dupla são anulados'}.`,
    'Mata-mata: com 2, 4 ou 8 grupos, o 1º de um grupo enfrenta o 2º de outro. Com 3, 5, 6 ou 7 grupos, entram os 1ºs e os melhores 2ºs (aproveitamento, saldo médio por jogo, games pró por jogo e sorteio). Não há disputa de 3º lugar.',
    'Protestos: até o fechamento do grupo pela organização. Depois disso o placar vale como está.',
    `Descanso mínimo de ${R.descanso_min} minutos entre jogos do mesmo atleta, salvo decisão da organização.`,
  ].join('\n\n');
}

async function arenaGerarRegulamento() {
  if (arRegras().regulamento && !(await arConfirm('Gerar regulamento', 'O texto atual será substituído pelo resumo gerado das regras. Você pode editar depois.', 'Substituir'))) return;
  await arenaSalvarCamp({ regras: { ...arRegras(), regulamento: arRegulamentoGerado() } }, 'Regulamento gerado. Revise o texto.');
}

async function arenaEditarRegulamento() {
  const v = await arForm({ titulo: 'Regulamento resumido', campos: [{ nome: 'regulamento', rotulo: 'Texto publicado na página pública', tipo: 'textarea', linhas: 14, valor: arRegras().regulamento || arRegulamentoGerado() }] });
  if (!v) return;
  arenaSalvarCamp({ regras: { ...arRegras(), regulamento: v.regulamento.slice(0, 20000) } }, 'Regulamento salvo.');
}

async function arenaCopiar(txt) {
  try {
    await navigator.clipboard.writeText(txt);
    arToast('Link copiado.');
  } catch {
    arForm({ titulo: 'Copie o link', campos: [{ nome: 'l', rotulo: 'Link', valor: txt }], ok: 'Fechar' });
  }
}

async function arenaTrocarToken() {
  if (!(await arConfirm('Trocar o link de inscrição', 'O link atual para de funcionar na hora. Quem já se inscreveu continua inscrito.', 'Trocar link', true))) return;
  arenaSalvarCamp({ inscricao_token: arToken() }, 'Link trocado. Copie e divulgue o novo.');
}

async function arenaEditarCat(id) {
  const c = id ? ARENA.c.cats.find(x => x.id === id) : null;
  const f = arFormato(c);
  const v = await arForm({
    titulo: c ? 'Editar categoria' : 'Nova categoria',
    campos: [
      { nome: 'nome', rotulo: 'Nome', obrigatorio: true, valor: c?.nome || '', placeholder: 'Masculino B' },
      { nome: 'genero', rotulo: 'Gênero (só aviso)', tipo: 'select', valor: c?.genero || '', meio: true, opcoes: [['', 'Livre'], ['masculino', 'Masculino'], ['feminino', 'Feminino'], ['misto', 'Misto']] },
      { nome: 'max_duplas', rotulo: 'Limite de duplas', tipo: 'number', valor: c?.max_duplas ?? 16, meio: true, extra: 'min="3" max="64" inputmode="numeric"' },
      { nome: 'classificam', rotulo: 'Classificam por grupo', tipo: 'select', valor: f.classificam, meio: true, opcoes: [[2, '1º e 2º'], [1, 'Só o 1º']] },
      { nome: 'inscricoes_abertas', rotulo: 'Inscrições', tipo: 'select', valor: c?.inscricoes_abertas === false ? 'nao' : 'sim', meio: true, opcoes: [['sim', 'Abertas'], ['nao', 'Fechadas']] },
      { nome: 'preset_grupo', rotulo: 'Preset nos grupos', tipo: 'select', valor: f.preset_grupo, meio: true, opcoes: [['A', 'A (até 6)'], ['B', 'B (até 4)']] },
      { nome: 'preset_mata', rotulo: 'Preset no mata-mata', tipo: 'select', valor: f.preset_mata, meio: true, opcoes: [['A', 'A (até 6)'], ['B', 'B (até 4)']] },
    ],
  });
  if (!v) return;
  const linha = {
    nome: v.nome, genero: v.genero || null, max_duplas: Math.max(3, +v.max_duplas || 16), inscricoes_abertas: v.inscricoes_abertas !== 'nao',
    formato: { ...f, classificam: +v.classificam, preset_grupo: v.preset_grupo, preset_mata: v.preset_mata },
  };
  await arAcao(async () => {
    const db = arenaDb();
    if (c) Object.assign(c, await db.update('categories', c.id, linha));
    else ARENA.c.cats.push(await db.insert('categories', { ...linha, championship_id: ARENA.c.camp.id, ordem: ARENA.c.cats.length + 1 }));
    if (!ARENA.catId) ARENA.catId = ARENA.c.cats[0].id;
    arenaRenderCamp();
  }, 'Categoria salva.');
}

async function arenaRemoverCat(id) {
  const c = ARENA.c.cats.find(x => x.id === id);
  if (arTeamsCat(id).length) return arToast('A categoria tem duplas. Mude-as de categoria ou cancele antes de remover.', 'erro');
  if (!(await arConfirm('Remover categoria', `Remover <b>${arEsc(c.nome)}</b>?`, 'Remover', true))) return;
  await arAcao(async () => {
    await arenaDb().remove('categories', id);
    ARENA.c.cats = ARENA.c.cats.filter(x => x.id !== id);
    if (ARENA.catId === id) ARENA.catId = ARENA.c.cats[0]?.id || null;
    arenaRenderCamp();
  }, 'Categoria removida.');
}

// ── Conta de capacidade (motor: capacidade) ──────────────
function arenaCapacidadeHtml() {
  const C = window.BT8Championship;
  if (!C || !ARENA.c.cats.length) return '';
  const R = arRegras();
  const limite = ARENA.capBase === 'limite';
  const quadras = ARENA.quadras.filter(q => q.ativa !== false).length;
  let r;
  try {
    r = C.capacidade({
      ...R, dias: R.dias?.length ? R.dias : undefined, quadras,
      categorias: ARENA.c.cats.map(c => {
        const f = arFormato(c);
        return { nome: c.nome, duplas: limite ? c.max_duplas || 0 : arTeamsCat(c.id).filter(arAtiva).length, tam_grupo: f.tam_grupo, classificam: f.classificam };
      }),
    });
  } catch (e) {
    return `<div class="ar-card"><div class="ar-h">Conta de capacidade</div><div class="ar-alerta">${arEsc(e.message)}</div></div>`;
  }
  const linhas = r.porCategoria.map(c => `<tr><td>${arEsc(c.nome)}</td><td>${c.duplas}</td><td>${c.grupos}</td><td>${c.jogosGrupo}</td><td>${c.jogosMata}</td><td><b>${c.total}</b></td></tr>`).join('');
  return `
    <div class="ar-card">
      <div class="ar-card-h"><div class="ar-h">Conta de capacidade</div>
        <select class="input-field ar-mini" aria-label="Base da conta" onchange="ARENA.capBase=this.value;arenaRenderCamp()">
          <option value="inscritas" ${!limite ? 'selected' : ''}>Duplas inscritas</option>
          <option value="limite" ${limite ? 'selected' : ''}>Limite das categorias</option>
        </select></div>
      ${!quadras ? `<div class="ar-alerta">${icon('alert')} Nenhuma quadra ativa: cadastre as quadras em Minha arena.</div>` : ''}
      <div class="ar-kpis">
        <div><b>${r.jogos}</b><span>jogos</span></div>
        <div><b>${r.capacidade}</b><span>capacidade (${r.capacidadePorDia.join(' + ')})</span></div>
        <div class="${r.alerta ? 'ruim' : 'bom'}"><b>${r.sobraPct}%</b><span>sobra (${r.sobra} jogos)</span></div>
      </div>
      <p class="ar-txt">${quadras} quadra(s) · ${R.duracao_media_min} + ${R.intervalo_min} min por jogo · ${(R.dias || []).length || 2} dia(s).</p>
      ${r.alerta ? `<div class="ar-alerta">${icon('alert')} Sobra abaixo de 15%. Opções: ${r.opcoes.map(arEsc).join(', ')}.</div>` : ''}
      <div class="ar-table-wrap"><table class="ar-table">
        <thead><tr><th>Categoria</th><th>Duplas</th><th>Grupos</th><th>Grupo</th><th>Mata</th><th>Total</th></tr></thead>
        <tbody>${linhas}</tbody></table></div>
    </div>`;
}

// ── Seletor de categoria (Inscritos, Sorteio, Grupos e chave) ──
function arCatTabs(fn) {
  return arTabs(ARENA.c.cats.map(c => [c.id, c.nome]), ARENA.catId, fn);
}

function arSemCategorias(id, titulo) {
  arScreen(id, titulo, '<div class="ar-card ar-centro"><p class="ar-txt">Crie as categorias na tela do campeonato primeiro.</p></div>');
}

// ══ INSCRITOS ════════════════════════════════════════════
function arenaAbrirInscritos() {
  ARENA.verCanceladas = false;
  goTo('screen-arena-inscritos');
  arenaRenderInscritos();
}

function arenaCatInscritos(id) {
  ARENA.catId = id;
  arenaRenderInscritos();
}

function arNoGrupo(teamId) {
  return ARENA.c.groupTeams.some(x => x.team_id === teamId);
}

function arenaRenderInscritos() {
  if (!ARENA.c.cats.length) return arSemCategorias('screen-arena-inscritos', 'Inscritos');
  const cat = ARENA.c.cats.find(c => c.id === ARENA.catId);
  const todas = arTeamsCat(cat.id);
  const n = s => todas.filter(t => t.status === s).length;
  const pagas = todas.filter(t => t.pagamento === 'pago').length;
  const g = arG();
  const ordemStatus = { confirmada: 0, pendente: 1, espera: 2, cancelada: 3 };
  const lista = todas
    .filter(t => ARENA.verCanceladas || t.status !== 'cancelada')
    .sort((a, b) => ordemStatus[a.status] - ordemStatus[b.status] || arDupla(a).localeCompare(arDupla(b), 'pt-BR'))
    .map(t => arenaDuplaHtml(t, g)).join('');
  arScreen('screen-arena-inscritos', 'Inscritos', `
    ${arCatTabs('arenaCatInscritos')}
    <div class="ar-kpis ar-kpis-sm">
      <div><b>${n('confirmada')}</b><span>confirmadas</span></div>
      <div><b>${n('pendente')}</b><span>aguardando Pix</span></div>
      <div><b>${n('espera')}</b><span>espera</span></div>
      <div><b>${pagas}</b><span>pagas</span></div>
      <div><b>${n('confirmada') + n('pendente')}/${cat.max_duplas || '∞'}</b><span>vagas</span></div>
    </div>
    ${g ? `<div class="ar-botoes">
      <button class="btn btn-yellow btn-sm" onclick="arenaInscreverDupla()">${icon('plus')} Inscrever dupla</button>
      <button class="btn btn-ghost btn-sm" onclick="arenaColarLista()">Colar lista</button>
      ${ARENA.c.groups.some(x => x.category_id === cat.id) ? `<button class="btn btn-ghost btn-sm" onclick="arenaAvisarDuplas('${cat.id}')">Avisar duplas por e-mail</button>` : ''}
    </div>` : ''}
    <label class="ar-check ar-filtro"><input type="checkbox" ${ARENA.verCanceladas ? 'checked' : ''} onchange="ARENA.verCanceladas=this.checked;arenaRenderInscritos()"> <span>Mostrar canceladas (${n('cancelada')})</span></label>
    <div class="ar-list">${lista || '<div class="ar-vazio">Nenhuma dupla nesta categoria.</div>'}</div>`);
}

function arWhats(a) {
  if (!a?.telefone) return '';
  return `<a class="btn btn-ghost btn-sm" href="https://wa.me/${a.telefone.replace(/\D/g, '')}" target="_blank" rel="noopener">WhatsApp ${arEsc(a.nome.split(' ')[0])}</a>`;
}

function arenaDuplaHtml(t, g) {
  const a1 = ARENA.c.atl[t.athlete1_id], a2 = ARENA.c.atl[t.athlete2_id];
  const tipo = { confirmada: 'ok', pendente: 'warn', espera: 'mute', cancelada: 'err' }[t.status];
  const noGrupo = arNoGrupo(t.id);
  const acoes = g && t.status !== 'cancelada' ? `
      <button class="btn btn-ghost btn-sm" onclick="arenaEditarDupla('${t.id}')">${icon('pencil')} Editar</button>
      <button class="btn btn-ghost btn-sm" onclick="arenaTrocarAtleta('${t.id}')">${icon('repeat')} Trocar atleta</button>
      ${!noGrupo && ARENA.c.cats.length > 1 ? `<button class="btn btn-ghost btn-sm" onclick="arenaMudarCat('${t.id}')">Mudar de categoria</button>` : ''}
      ${arBotoesPagamento(t)}
      <button class="btn btn-ghost btn-sm" onclick="arenaLinkDupla('${t.id}')">${icon('share')} Link da dupla</button>
      <button class="btn btn-ghost btn-sm" onclick="arenaLinkDupla('${t.id}', true)">${icon('refresh')} Gerar link novo</button>
      ${t.status === 'espera' ? `<button class="btn btn-ghost btn-sm" onclick="arenaConfirmarVaga('${t.id}')">Confirmar vaga</button>` : ''}
      ${noGrupo
        ? (!t.desistente_em ? `<button class="btn btn-ghost btn-sm" onclick="mesaSubstituir('${t.id}')">Substituir dupla</button>
          <button class="btn btn-coral btn-sm" onclick="arenaDesistencia('${t.id}')">Desistência</button>` : '')
        : `<button class="btn btn-coral btn-sm" onclick="arenaCancelarDupla('${t.id}')">Cancelar</button>`}` : '';
  return `
    <details class="ar-item">
      <summary>
        <span class="ar-row-main"><b>${arEsc(arDupla(t))}</b>
          <small>${t.seed ? `cabeça ${t.seed} · ` : ''}${arEsc({ link: 'pelo link', importacao: 'lista colada', manual: 'cadastro manual' }[t.origem] || '')}${t.observacao ? ' · ' + arEsc(t.observacao) : ''}</small></span>
        ${arChip(AR_STATUS_DUPLA[t.status] || t.status, tipo)}
        ${t.pagamento === 'pago' ? arChip('Pago', 'ok') : ''}
        ${t.pagamento !== 'pago' && t.comprovante_status === 'enviado' ? arChip('Comprovante enviado', 'warn') : ''}
        ${t.pagamento !== 'pago' && t.comprovante_status === 'recusado' ? arChip('Comprovante recusado', 'err') : ''}
        ${t.desistente_em ? arChip('Desistente', 'err') : ''}
      </summary>
      <div class="ar-item-corpo">
        <div class="ar-txt">${arEsc(a1?.nome)}: ${arEsc(a1?.telefone || 'sem telefone')} · ${arEsc(a2?.nome)}: ${arEsc(a2?.telefone || 'sem telefone')}</div>
        <div class="ar-botoes">${arWhats(a1)}${arWhats(a2)}${acoes}</div>
      </div>
    </details>`;
}

async function arenaRecarregar(render) {
  await arenaCarregarCamp(ARENA.c.camp.id);
  render();
}

// Reaproveita o atleta da arena pelo telefone (único por arena); sem telefone, cria um novo.
async function arGarantirAtleta(nome, telefone) {
  const tel = telefone ? arE164(telefone) : null;
  if (telefone && !tel) throw new Error(`Telefone inválido: ${telefone}`);
  if (tel) {
    const ex = ARENA.c.athletes.find(a => a.telefone === tel);
    if (ex) return ex;
  }
  const a = await arenaDb().insert('athletes', { arena_id: ARENA.arena.id, nome, telefone: tel });
  ARENA.c.athletes.push(a);
  ARENA.c.atl[a.id] = a;
  return a;
}

function arStatusNovaDupla(catId) {
  const cat = ARENA.c.cats.find(c => c.id === catId);
  const pix = !!arRegras().pix?.chave;
  const ativas = arTeamsCat(catId).filter(arAtiva).length;
  const pagamento = pix ? 'pendente' : 'nao_se_aplica';
  if (cat.max_duplas && ativas >= cat.max_duplas) return { status: 'espera', pagamento };
  return { status: pix ? 'pendente' : 'confirmada', pagamento };
}

function arAtletaNaCategoria(catId, atletaId, excetoTeam) {
  return arTeamsCat(catId).find(t => t.id !== excetoTeam && t.status !== 'cancelada' && (t.athlete1_id === atletaId || t.athlete2_id === atletaId));
}

async function arCriarDupla(catId, d1, d2, origem) {
  const a1 = await arGarantirAtleta(d1.nome, d1.telefone);
  const a2 = await arGarantirAtleta(d2.nome, d2.telefone);
  if (a1.id === a2.id) throw new Error('Os dois atletas têm o mesmo telefone.');
  for (const a of [a1, a2]) {
    const ja = arAtletaNaCategoria(catId, a.id);
    if (ja) throw new Error(`${a.nome} já está inscrito nesta categoria (${arDupla(ja)}).`);
  }
  const t = await arenaDb().insert('teams', { category_id: catId, athlete1_id: a1.id, athlete2_id: a2.id, origem, ...arStatusNovaDupla(catId) });
  ARENA.c.teams.push(t);
  return t;
}

async function arenaInscreverDupla() {
  const v = await arForm({
    titulo: 'Inscrever dupla',
    campos: [
      { nome: 'n1', rotulo: 'Atleta 1', obrigatorio: true, meio: true },
      { nome: 't1', rotulo: 'WhatsApp 1 (opcional)', tipo: 'tel', meio: true, placeholder: '(81) 99999-0000' },
      { nome: 'n2', rotulo: 'Atleta 2', obrigatorio: true, meio: true },
      { nome: 't2', rotulo: 'WhatsApp 2 (opcional)', tipo: 'tel', meio: true },
    ],
    ok: 'Inscrever',
  });
  if (!v) return;
  await arAcao(async () => {
    const t = await arCriarDupla(ARENA.catId, { nome: v.n1, telefone: v.t1 }, { nome: v.n2, telefone: v.t2 }, 'manual');
    arenaRenderInscritos();
    arToast(t.status === 'espera' ? 'Categoria lotada: dupla na lista de espera.' : 'Dupla inscrita.');
  });
}

async function arenaColarLista(texto = '') {
  const v = await arForm({
    titulo: 'Colar lista',
    texto: 'Uma dupla por linha: <b>Nome1 / Nome2</b>. O telefone é opcional, depois de cada nome.<br><span class="ar-mono">Ana Souza 81999990000 / Bia Lima</span>',
    campos: [{ nome: 'lista', rotulo: 'Lista', tipo: 'textarea', linhas: 10, valor: texto, obrigatorio: true }],
    ok: 'Verificar',
  });
  if (!v) return;
  const r = BT8Championship.parseListaInscritos(v.lista);
  const ja = [];
  const novas = r.duplas.filter(d => {
    const rep = [d.atleta1, d.atleta2].map(a => arTeamsCat(ARENA.catId).find(t => t.status !== 'cancelada'
      && [ARENA.c.atl[t.athlete1_id], ARENA.c.atl[t.athlete2_id]].some(x => x && (x.telefone && x.telefone === a.telefone || arSlug(x.nome) === arSlug(a.nome))))).find(Boolean);
    if (rep) ja.push({ linha: d.linha, motivo: `já inscrito em ${arDupla(rep)}` });
    return !rep;
  });
  const problemas = [...r.invalidas, ...r.duplicadas, ...ja].sort((a, b) => a.linha - b.linha);
  const resumo = `
    <p><b>${novas.length}</b> dupla(s) prontas para gravar.</p>
    ${problemas.length ? `<p>${problemas.length} linha(s) ignorada(s):</p><ul class="ar-ul">${problemas.map(p => `<li>Linha ${p.linha}: ${arEsc(p.motivo)}</li>`).join('')}</ul>` : ''}`;
  if (!novas.length) {
    arToast('Nenhuma dupla válida na lista.', 'erro');
    return arenaColarLista(v.lista);
  }
  const ok = await arForm({ titulo: 'Conferir lista', texto: resumo, ok: `Gravar ${novas.length} dupla(s)` });
  if (!ok) return arenaColarLista(v.lista);
  let gravadas = 0;
  const erros = [];
  for (const d of novas) {
    try {
      await arCriarDupla(ARENA.catId, d.atleta1, d.atleta2, 'importacao');
      gravadas++;
    } catch (e) {
      erros.push(`Linha ${d.linha}: ${e.message}`);
    }
  }
  arenaRenderInscritos();
  arToast(erros.length ? `${gravadas} gravada(s). Falhas: ${erros.join('; ')}` : `${gravadas} dupla(s) gravada(s).`, erros.length ? 'erro' : 'ok');
}

async function arenaEditarDupla(id) {
  const t = arTeam(id);
  const a1 = ARENA.c.atl[t.athlete1_id], a2 = ARENA.c.atl[t.athlete2_id];
  const v = await arForm({
    titulo: 'Editar dupla',
    campos: [
      { nome: 'n1', rotulo: 'Atleta 1', obrigatorio: true, valor: a1?.nome, meio: true },
      { nome: 't1', rotulo: 'WhatsApp 1', tipo: 'tel', valor: a1?.telefone || '', meio: true },
      { nome: 'n2', rotulo: 'Atleta 2', obrigatorio: true, valor: a2?.nome, meio: true },
      { nome: 't2', rotulo: 'WhatsApp 2', tipo: 'tel', valor: a2?.telefone || '', meio: true },
      { nome: 'observacao', rotulo: 'Observação', valor: t.observacao || '' },
    ],
  });
  if (!v) return;
  await arAcao(async () => {
    const db = arenaDb();
    for (const [a, nome, tel] of [[a1, v.n1, v.t1], [a2, v.n2, v.t2]]) {
      const telefone = tel ? arE164(tel) : null;
      if (tel && !telefone) throw new Error(`Telefone inválido: ${tel}`);
      if (a && (a.nome !== nome || (a.telefone || null) !== telefone)) Object.assign(a, await db.update('athletes', a.id, { nome, telefone }));
    }
    if ((t.observacao || '') !== v.observacao) Object.assign(t, await db.update('teams', t.id, { observacao: v.observacao || null }));
    arenaRenderInscritos();
  }, 'Dupla salva.');
}

async function arenaTrocarAtleta(id) {
  const t = arTeam(id);
  const v = await arForm({
    titulo: 'Trocar atleta',
    texto: 'Vale até o primeiro jogo da dupla. A dupla continua a mesma no sorteio.',
    campos: [
      { nome: 'pos', rotulo: 'Sai', tipo: 'select', valor: '1', opcoes: [['1', ARENA.c.atl[t.athlete1_id]?.nome || 'Atleta 1'], ['2', ARENA.c.atl[t.athlete2_id]?.nome || 'Atleta 2']] },
      { nome: 'nome', rotulo: 'Entra', obrigatorio: true, meio: true },
      { nome: 'tel', rotulo: 'WhatsApp (opcional)', tipo: 'tel', meio: true },
    ],
    ok: 'Trocar',
  });
  if (!v) return;
  await arAcao(async () => {
    const a = await arGarantirAtleta(v.nome, v.tel);
    const outro = v.pos === '1' ? t.athlete2_id : t.athlete1_id;
    if (a.id === outro) throw new Error('Esse atleta já é o parceiro da dupla.');
    const ja = arAtletaNaCategoria(t.category_id, a.id, t.id);
    if (ja) throw new Error(`${a.nome} já está inscrito nesta categoria (${arDupla(ja)}).`);
    if (arNoGrupo(t.id)) await arenaDb().rpc('team_swap_athlete', { p_team: t.id, p_posicao: +v.pos, p_athlete: a.id });
    else await arenaDb().update('teams', t.id, { [`athlete${v.pos}_id`]: a.id });
    await arenaRecarregar(arenaRenderInscritos);
  }, 'Atleta trocado.');
}

async function arenaMudarCat(id) {
  const t = arTeam(id);
  const outras = ARENA.c.cats.filter(c => c.id !== t.category_id);
  const v = await arForm({ titulo: 'Mudar de categoria', campos: [{ nome: 'cat', rotulo: 'Nova categoria', tipo: 'select', opcoes: outras.map(c => [c.id, c.nome]), valor: outras[0]?.id }], ok: 'Mudar' });
  if (!v) return;
  for (const a of [t.athlete1_id, t.athlete2_id]) {
    const ja = arAtletaNaCategoria(v.cat, a);
    if (ja) return arToast(`${ARENA.c.atl[a]?.nome} já está em ${arDupla(ja)} nessa categoria.`, 'erro');
  }
  await arAcao(async () => {
    Object.assign(t, await arenaDb().update('teams', t.id, { category_id: v.cat }));
    arenaRenderInscritos();
  }, 'Dupla movida.');
}

// Pagamento pela Function arena-pagamento (confere o papel, guarda o comprovante e avisa os atletas por e-mail).
function arBotoesPagamento(t) {
  if (t.pagamento === 'nao_se_aplica' && !arRegras().pix?.chave) return '';
  const b = (acao, rotulo, ic = '') => `<button class="btn btn-ghost btn-sm" onclick="arenaPagamento('${t.id}', '${acao}')">${ic}${rotulo}</button>`;
  return [
    t.comprovante_path ? b('ver', 'Ver comprovante', icon('download') + ' ') : '',
    t.pagamento !== 'pago' ? b('confirmar', 'Confirmar pagamento', icon('check') + ' ') : '',
    t.pagamento !== 'pago' && t.comprovante_status === 'enviado' ? b('recusar', 'Recusar comprovante') : '',
    t.pagamento === 'pago' || t.comprovante_status === 'recusado' ? b('desfazer', t.pagamento === 'pago' ? 'Desfazer pagamento' : 'Desfazer recusa') : '',
  ].join('');
}

async function arenaPagamento(id, acao) {
  const t = arTeam(id);
  if (acao === 'ver') {
    // Abre a aba já no clique (senão o navegador bloqueia o pop-up) e troca o endereço quando a URL assinada chega.
    const aba = window.open('', '_blank');
    return arAcao(async () => {
      try {
        const r = await arenaDb().pagamento({ team_id: id, acao });
        if (aba) aba.location.href = r.url; else location.href = r.url;
      } catch (e) { aba?.close(); throw e; }
    });
  }
  let motivo;
  if (acao === 'recusar') {
    const v = await arForm({ titulo: 'Recusar comprovante', texto: 'A dupla vê o motivo na página de acompanhamento e recebe por e-mail (se informou).',
      campos: [{ nome: 'motivo', rotulo: 'Motivo', placeholder: 'Ex.: valor diferente da inscrição', extra: 'maxlength="280" required' }], ok: 'Recusar', perigo: true });
    if (!v) return;
    motivo = v.motivo;
  } else if (acao === 'desfazer' && !(await arConfirm('Desfazer', t.pagamento === 'pago'
    ? 'O pagamento volta para pendente e a dupla para "Aguardando Pix".' : 'A recusa é desfeita e o comprovante volta para conferência.', 'Desfazer'))) return;
  await arAcao(async () => {
    const r = await arenaDb().pagamento({ team_id: id, acao, motivo });
    Object.assign(t, r.team);
    if (!r.team.tem_comprovante) t.comprovante_path = null;
    arenaRenderInscritos();
  }, { confirmar: 'Pagamento confirmado.', recusar: 'Comprovante recusado.', desfazer: 'Desfeito.' }[acao]);
}

// Link /acompanhar/<token> da dupla (RPC arena_team_link: só dono/gestor). "novo" troca o token: o antigo para na hora.
async function arenaLinkDupla(id, novo = false) {
  if (novo && !(await arConfirm('Gerar link novo', 'O link atual da dupla para de funcionar na hora. Use se ele foi parar com quem não devia e mande o novo para a dupla.', 'Gerar link novo', true))) return;
  await arAcao(async () => {
    const r = await arenaDb().rpc('arena_team_link', { p_team: id, p_novo: novo });
    await arenaCopiar(arLink('/acompanhar/' + r.token));
  });
}

// Depois do sorteio publicado: e-mail "tabela publicada" para as duplas da categoria (cada uma recebe uma vez).
async function arenaAvisarDuplas(catId) {
  const cat = ARENA.c.cats.find(c => c.id === catId);
  if (!(await arConfirm('Avisar duplas por e-mail', `Enviar o grupo e o primeiro jogo para as duplas de <b>${arEsc(cat?.nome)}</b> que informaram e-mail? Quem já foi avisado não recebe de novo.`, 'Enviar'))) return;
  await arAcao(async () => {
    const r = await arenaDb().notificar({ category_id: catId });
    arToast(r.mensagem || 'Duplas avisadas.');
  });
}

async function arenaConfirmarVaga(id) {
  const t = arTeam(id);
  const cat = ARENA.c.cats.find(c => c.id === t.category_id);
  const ativas = arTeamsCat(cat.id).filter(arAtiva).length;
  if (cat.max_duplas && ativas >= cat.max_duplas
    && !(await arConfirm('Categoria lotada', `A categoria já tem ${ativas} de ${cat.max_duplas} duplas. Confirmar mesmo assim?`, 'Confirmar'))) return;
  const status = t.pagamento === 'pendente' ? 'pendente' : 'confirmada';
  await arAcao(async () => {
    Object.assign(t, await arenaDb().update('teams', id, { status }));
    arenaRenderInscritos();
  }, 'Vaga confirmada.');
}

async function arenaCancelarDupla(id) {
  const t = arTeam(id);
  if (!(await arConfirm('Cancelar inscrição', `Cancelar a dupla <b>${arEsc(arDupla(t))}</b>?`, 'Cancelar dupla', true))) return;
  await arAcao(async () => {
    Object.assign(t, await arenaDb().update('teams', id, { status: 'cancelada' }));
    arenaRenderInscritos();
  }, 'Inscrição cancelada.');
}

async function arenaDesistencia(id) {
  const t = arTeam(id);
  const manter = arRegras().desistencia_modo === 'manter_wo';
  const fechados = new Set(ARENA.c.groups.filter(g => g.fechado_em).map(g => g.id));
  // Jogos ainda sem resultado: no grupo aberto, WO (manter_wo) ou anulação (anular); no mata-mata, sempre WO para o adversário.
  const restantes = ARENA.c.matches.filter(m => (m.team_a === id || m.team_b === id) && m.team_a && m.team_b && !arFinal(m)
    && !(m.group_id && fechados.has(m.group_id)));
  const modo = manter ? 'Os jogos já feitos valem e os restantes contam como WO.' : 'Todos os jogos da dupla no grupo são anulados (os ainda não jogados ficam como anulados).';
  if (!(await arConfirm('Registrar desistência', `<b>${arEsc(arDupla(t))}</b> desiste do campeonato. ${modo}
    ${restantes.length ? `<p>${restantes.length} jogo(s) restante(s) serão encerrados agora.</p>` : ''}`, 'Registrar', true))) return;
  await arAcao(async () => {
    Object.assign(t, await arenaDb().update('teams', id, { desistente_em: new Date().toISOString() }));
    const erros = [];
    for (const m of restantes) {
      const lado = m.team_a === id ? 'a' : 'b';
      try {
        await arenaDb().rpc('match_wo', { p_match: m.id, p_ausente: m.fase === 'grupo' && !manter ? 'duplo' : lado, p_motivo: 'Desistência da dupla' });
      } catch (e) {
        erros.push(`${arJogoNome(m)} ${m.fase === 'grupo' ? `R${m.rodada}` : ''}: ${e.message}`);
      }
    }
    await arenaRecarregar(arenaRenderInscritos);
    if (erros.length) throw new Error(`Desistência registrada, mas ${erros.length} jogo(s) não foram encerrados: ${erros.join('; ')}`);
  }, 'Desistência registrada.');
}

// ══ SORTEIO ══════════════════════════════════════════════
function arenaAbrirSorteio() {
  goTo('screen-arena-sorteio');
  arenaRenderSorteio();
}

function arenaCatSorteio(id) {
  ARENA.catId = id;
  arenaRenderSorteio();
}

const arElegiveis = catId => arTeamsCat(catId).filter(t => arAtiva(t) && !t.desistente_em);
const arDuplasDoGrupo = gid => ARENA.c.groupTeams.filter(x => x.group_id === gid).map(x => x.team_id);

function arGruposHtml(grupos, mover) {
  const nomes = grupos.map(g => g.nome);
  return `<div class="ar-grupos">${grupos.map(g => `
    <div class="ar-grupo">
      <div class="ar-grupo-h">Grupo ${arEsc(g.nome)} <small>${g.duplas.length} duplas</small></div>
      ${g.duplas.map(id => {
        const t = arTeam(id);
        return `<div class="ar-grupo-l">
          <span>${t?.seed ? `<b class="ar-seed">${t.seed}</b>` : ''}${arEsc(arDupla(t))}</span>
          ${mover ? `<select class="input-field ar-mini" aria-label="Mover ${arEsc(arDupla(t))}" onchange="arenaMover('${id}', this.value)">${nomes.map(n =>
            `<option value="${n}" ${n === g.nome ? 'selected' : ''}>${n}</option>`).join('')}</select>` : ''}
        </div>`;
      }).join('')}
    </div>`).join('')}</div>`;
}

function arenaRenderSorteio() {
  if (!ARENA.c.cats.length) return arSemCategorias('screen-arena-sorteio', 'Sorteio');
  const cat = ARENA.c.cats.find(c => c.id === ARENA.catId);
  const g = arG();
  const elig = arElegiveis(cat.id).sort((a, b) => (a.seed || 99) - (b.seed || 99) || arDupla(a).localeCompare(arDupla(b), 'pt-BR'));
  const publicados = arGruposCat(cat.id).map(x => ({ nome: x.nome, duplas: arDuplasDoGrupo(x.id) }));
  const draft = ARENA.draft[cat.id];
  const nGrupos = elig.length >= 3 ? BT8Championship.tamanhosGrupos(elig.length, arFormato(cat).tam_grupo).length : 0;
  const maxSeed = Math.max(nGrupos, 1);
  const iniciado = ARENA.c.matches.some(m => m.category_id === cat.id && (m.status !== 'agendada' || m.games_a != null));

  let corpo;
  if (draft) {
    corpo = `
      <div class="ar-card">
        <div class="ar-card-h"><div class="ar-h">Prévia do sorteio</div><span class="ar-sub">semente ${draft.semente}</span></div>
        <p class="ar-txt">Mova uma dupla trocando o grupo dela. Nada foi gravado ainda.</p>
        ${arGruposHtml(draft.grupos, true)}
        <div class="ar-botoes">
          <button class="btn btn-yellow" onclick="arenaPublicar()">${icon('check')} Publicar sorteio</button>
          <button class="btn btn-ghost btn-sm" onclick="arenaSortear()">${icon('dices')} Sortear de novo</button>
          <button class="btn btn-ghost btn-sm" onclick="delete ARENA.draft[ARENA.catId];arenaRenderSorteio()">Descartar</button>
        </div>
      </div>`;
  } else if (publicados.length) {
    corpo = `
      <div class="ar-card">
        <div class="ar-card-h"><div class="ar-h">Sorteio publicado</div>${cat.sorteio_semente ? `<span class="ar-sub">semente ${arEsc(cat.sorteio_semente)}</span>` : ''}</div>
        ${arGruposHtml(publicados, false)}
        ${g ? (iniciado
          ? `<p class="ar-txt">${icon('lock')} A categoria já tem jogo iniciado: o sorteio não pode ser refeito.</p>`
          : `<div class="ar-botoes"><button class="btn btn-ghost btn-sm" onclick="arenaRefazer()">${icon('refresh')} Refazer sorteio</button></div>`) : ''}
      </div>`;
  } else {
    corpo = g ? `<div class="ar-card ar-centro">
        <p class="ar-txt">${elig.length} dupla(s) aptas · ${nGrupos ? `${nGrupos} grupo(s) de 3 ou 4${nGrupos === 1 ? ' (grupo único, final entre 1º e 2º)' : ''}` : 'mínimo de 3 duplas'}.</p>
        <button class="btn btn-yellow" onclick="arenaSortear()" ${elig.length < 3 ? 'disabled' : ''}>${icon('dices')} Sortear grupos</button>
      </div>` : '<div class="ar-card ar-centro"><p class="ar-txt">O sorteio ainda não foi publicado.</p></div>';
  }

  const seeds = g && !publicados.length || draft ? `
    <div class="ar-card">
      <div class="ar-card-h"><div class="ar-h">Cabeças de chave</div></div>
      <p class="ar-txt">Até ${maxSeed} cabeça(s), uma por grupo. A 1 é a principal. Entram duplas confirmadas e aguardando Pix.</p>
      <div class="ar-list">${elig.map(t => `
        <div class="ar-row">
          <span class="ar-row-main"><b>${arEsc(arDupla(t))}</b></span>
          <select class="input-field ar-mini" aria-label="Cabeça de chave de ${arEsc(arDupla(t))}" onchange="arenaSeed('${t.id}', this.value)">
            <option value="">-</option>${Array.from({ length: maxSeed }, (_, i) => `<option value="${i + 1}" ${t.seed === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}
          </select>
        </div>`).join('') || '<div class="ar-vazio">Nenhuma dupla apta.</div>'}</div>
    </div>` : '';

  arScreen('screen-arena-sorteio', 'Sorteio', `${arCatTabs('arenaCatSorteio')}${corpo}${seeds}`);
}

async function arenaSeed(teamId, valor) {
  const t = arTeam(teamId);
  const seed = valor ? +valor : null;
  const outro = seed && arElegiveis(t.category_id).find(x => x.id !== teamId && x.seed === seed);
  await arAcao(async () => {
    if (outro) Object.assign(outro, await arenaDb().update('teams', outro.id, { seed: null }));
    Object.assign(t, await arenaDb().update('teams', teamId, { seed }));
    delete ARENA.draft[t.category_id];
    arenaRenderSorteio();
  });
}

function arenaSortear() {
  const elig = arElegiveis(ARENA.catId);
  const tam = arFormato(ARENA.c.cats.find(c => c.id === ARENA.catId)).tam_grupo;
  const nGrupos = BT8Championship.tamanhosGrupos(elig.length, tam).length;
  const r = BT8Championship.montarGrupos(elig.map(t => ({ id: t.id, seed: t.seed && t.seed <= nGrupos ? t.seed : null })), { tam_grupo: tam });
  ARENA.draft[ARENA.catId] = { semente: r.semente, grupos: r.grupos };
  arenaRenderSorteio();
}

function arenaMover(teamId, destino) {
  const d = ARENA.draft[ARENA.catId];
  d.grupos.forEach(g => { g.duplas = g.duplas.filter(id => id !== teamId); });
  d.grupos.find(g => g.nome === destino).duplas.push(teamId);
  arenaRenderSorteio();
  const tam = d.grupos.map(g => g.duplas.length);
  if (tam.some(n => n < 3 || n > 5)) arToast('Atenção: há grupo com menos de 3 ou mais de 5 duplas.', 'erro');
}

async function arenaRefazer() {
  if (!(await arConfirm('Refazer sorteio', 'O sorteio publicado será substituído quando você publicar o novo. Jogos de grupo e chave são regerados.', 'Refazer'))) return;
  arenaSortear();
}

// Payload de category_publish_draw (docs/ARENA.md 4.5) a partir da prévia e do motor.
function arPayloadSorteio(cat, draft) {
  const C = BT8Championship;
  const chave = C.gerarChave(draft.grupos.map(g => g.nome), { classificam: arFormato(cat).classificam });
  return C.payloadSorteio(draft, chave, { categoriaIndice: Math.max(0, (cat.ordem || 1) - 1) % 10 });
}

async function arenaPublicar() {
  const cat = ARENA.c.cats.find(c => c.id === ARENA.catId);
  const draft = ARENA.draft[cat.id];
  let payload;
  try {
    if (draft.grupos.some(g => g.duplas.length < 2)) throw new Error('Todo grupo precisa de pelo menos 2 duplas.');
    payload = arPayloadSorteio(cat, draft);
  } catch (e) {
    return arToast(e.message, 'erro');
  }
  const jogos = payload.partidas.filter(p => p.fase === 'grupo').length;
  if (!(await arConfirm('Publicar sorteio', `${draft.grupos.length} grupo(s), ${jogos} jogos de grupo e ${payload.partidas.length - jogos} do mata-mata em <b>${arEsc(cat.nome)}</b>. Os grupos ficam visíveis na página pública.`, 'Publicar'))) return;
  await arAcao(async () => {
    await arenaDb().rpc('category_publish_draw', { p_category: cat.id, p_payload: payload });
    delete ARENA.draft[cat.id];
    await arenaRecarregar(arenaRenderSorteio);
  }, 'Sorteio publicado.');
  if (ARENA.c.groups.some(g => g.category_id === cat.id)) await arenaAvisarDuplas(cat.id);
}

// ══ GRUPOS E CHAVE ═══════════════════════════════════════
function arenaAbrirChave() {
  goTo('screen-arena-chave');
  arenaRenderChave();
  clearInterval(ARENA.timer);
  // Classificação ao vivo: recarrega a cada 10 s enquanto a tela está aberta e visível.
  ARENA.timer = setInterval(() => {
    if (!document.getElementById('screen-arena-chave')?.classList.contains('active')) return clearInterval(ARENA.timer);
    if (document.visibilityState !== 'visible' || document.querySelector('.ar-modal')) return;
    arenaCarregarCamp(ARENA.c.camp.id).then(arenaRenderChave).catch(() => {});
  }, 10000);
}

function arenaCatChave(id) {
  ARENA.catId = id;
  arenaRenderChave();
}

const arVencedorLado = m => (m.vencedor && m.vencedor === m.team_a ? 'a' : m.vencedor && m.vencedor === m.team_b ? 'b' : null);
const arJogoMotor = m => ({ a: m.team_a, b: m.team_b, status: m.status, games_a: m.games_a, games_b: m.games_b, wo: m.wo || m.status === 'wo', vencedor: arVencedorLado(m) });
const arFinal = m => ['encerrada', 'wo', 'anulada'].includes(m.status);

function arClassificar(g, sorteio = g.sorteio_desempate?.ordem || []) {
  const R = arRegras();
  const ids = arDuplasDoGrupo(g.id);
  return BT8Championship.classificarGrupo(ids, ARENA.c.matches.filter(m => m.group_id === g.id).map(arJogoMotor), {
    desistencia_modo: R.desistencia_modo,
    wo_conta_saldo: R.wo_conta_saldo !== false,
    desistentes: ids.filter(id => arTeam(id)?.desistente_em),
    sorteio,
  });
}

function arPlacar(m) {
  if (m.status === 'anulada') return 'anulada';
  if (m.status === 'wo' || m.wo) return m.vencedor ? `WO, vence ${arDupla(arTeam(m.vencedor))}` : 'WO';
  if (m.games_a == null) return '-';
  return `${m.games_a}x${m.games_b}${m.tb_a != null ? ` (${m.tb_a}-${m.tb_b})` : ''}`;
}

function arenaGrupoHtml(g, cat, podeFechar) {
  const { tabela, pendenteSorteio } = arClassificar(g);
  const jogos = ARENA.c.matches.filter(m => m.group_id === g.id).sort((a, b) => a.rodada - b.rodada || a.slot - b.slot);
  const feitos = jogos.filter(arFinal).length;
  const classificam = arFormato(cat).classificam;
  const pronto = feitos === jogos.length && jogos.length > 0;
  return `
    <div class="ar-grupo ar-grupo-cls">
      <div class="ar-grupo-h">Grupo ${arEsc(g.nome)}
        ${g.fechado_em ? arChip('Fechado', 'ok') : arChip(`${feitos}/${jogos.length} jogos`, pronto ? 'warn' : 'mute')}</div>
      <table class="ar-table ar-cls">
        <thead><tr><th>#</th><th>Dupla</th><th title="Jogos">J</th><th title="Vitórias">V</th><th title="Saldo de games">SG</th><th title="Games pró">GP</th></tr></thead>
        <tbody>${tabela.map(l => `
          <tr class="${l.pos <= classificam && !l.desistente ? 'classif' : ''}">
            <td>${l.pos}</td>
            <td><span class="ar-cls-nome">${arEsc(arDupla(arTeam(l.team)))}</span>${l.criterio && l.jogos ? `<small class="ar-crit">${arEsc(l.criterio)}</small>` : ''}</td>
            <td>${l.jogos}</td><td>${l.vitorias}</td><td>${l.saldo > 0 ? '+' : ''}${l.saldo}</td><td>${l.gp}</td>
          </tr>`).join('')}</tbody>
      </table>
      ${pendenteSorteio.length && !g.fechado_em ? `<p class="ar-txt ar-aviso">${icon('alert')} Empate sem critério: será sorteado ao fechar o grupo.</p>` : ''}
      ${g.sorteio_desempate ? `<p class="ar-txt">Desempate por sorteio registrado.</p>` : ''}
      <details class="ar-jogos"><summary>Jogos do grupo</summary>
        ${jogos.map(m => `<div class="ar-jogo"><span>R${m.rodada}</span><span class="ar-jogo-n">${arEsc(arDupla(arTeam(m.team_a)))} <i>x</i> ${arEsc(arDupla(arTeam(m.team_b)))}</span><b>${arEsc(arPlacar(m))}</b>${arChip(AR_STATUS_JOGO[m.status] || m.status, arFinal(m) ? 'ok' : m.status === 'em_jogo' ? 'warn' : 'mute')}</div>`).join('')}
      </details>
      ${podeFechar && pronto && !g.fechado_em ? `<button class="btn btn-yellow btn-sm btn-full" onclick="arenaFecharGrupo('${g.id}')">${icon('lock')} Grupo ${arEsc(g.nome)} pronto: fechar</button>` : ''}
    </div>`;
}

function arOrigemTxt(o, porId) {
  if (!o) return 'a definir';
  if (o.grupo) return `${o.pos}º Grupo ${o.grupo}`;
  if (o.melhor1) return `Melhor 1º nº${o.melhor1}`;
  if (o.melhor2) return `Melhor 2º nº${o.melhor2}`;
  if (o.match) return `Vencedor ${arJogoNome(porId[o.match])}`;
  return 'a definir';
}
const arJogoNome = m => (m ? (m.fase === 'final' ? 'Final' : `${AR_FASE[m.fase]} ${m.slot}`) : '?');

function arenaMataHtml(cat) {
  const ko = ARENA.c.matches.filter(m => m.category_id === cat.id && m.fase !== 'grupo');
  if (!ko.length) return '';
  const ordem = { r16: 1, qf: 2, sf: 3, final: 4 };
  ko.sort((a, b) => ordem[a.fase] - ordem[b.fase] || a.slot - b.slot);
  const porId = Object.fromEntries(ko.map(m => [m.id, m]));
  const lado = (m, l) => {
    const t = arTeam(m[`team_${l}`]);
    return t ? arEsc(arDupla(t)) : `<span class="ar-vaga">${arEsc(arOrigemTxt(m[`origem_${l}`], porId))}</span>`;
  };
  return `
    <div class="ar-card">
      <div class="ar-card-h"><div class="ar-h">${icon('trophy')} Mata-mata</div></div>
      <div class="ar-list">${ko.map(m => `
        <div class="ar-jogo ar-jogo-ko ${m.alerta_origem ? 'alerta' : ''}">
          <span class="ar-jogo-fase">${arEsc(arJogoNome(m))}</span>
          <span class="ar-jogo-n">${lado(m, 'a')} <i>x</i> ${lado(m, 'b')}</span>
          <b>${arEsc(arPlacar(m))}</b>
          ${arChip(AR_STATUS_JOGO[m.status] || m.status, arFinal(m) ? 'ok' : m.status === 'em_jogo' ? 'warn' : 'mute')}
          ${m.alerta_origem ? `<span class="ar-chip err">${icon('alert')} Origem alterada, revisar</span>` : ''}
        </div>`).join('')}</div>
    </div>`;
}

function arenaRenderChave() {
  if (!ARENA.c.cats.length) return arSemCategorias('screen-arena-chave', 'Grupos e chave');
  const cat = ARENA.c.cats.find(c => c.id === ARENA.catId);
  const grupos = arGruposCat(cat.id);
  const g = arG();
  if (!grupos.length) {
    return arScreen('screen-arena-chave', 'Grupos e chave', `${arCatTabs('arenaCatChave')}
      <div class="ar-card ar-centro"><p class="ar-txt">Publique o sorteio desta categoria primeiro.</p>
      <button class="btn btn-ghost btn-sm" onclick="arenaAbrirSorteio()">${icon('dices')} Ir para o sorteio</button></div>`);
  }
  const ko = ARENA.c.matches.filter(m => m.category_id === cat.id && m.fase !== 'grupo');
  const todosFechados = grupos.every(x => x.fechado_em);
  const chaveVazia = ko.some(m => !m.team_a && !m.team_b && m.status === 'agendada' && (m.origem_a?.grupo || m.origem_a?.melhor1 || m.origem_a?.melhor2));
  arScreen('screen-arena-chave', 'Grupos e chave', `
    ${arCatTabs('arenaCatChave')}
    <p class="ar-txt">Desempate: vitórias, confronto direto (2 duplas) ou saldo entre as empatadas (3+), saldo no grupo, games pró e sorteio. Atualiza a cada 10 s.</p>
    ${g && todosFechados && chaveVazia ? `<div class="ar-card ar-centro"><p class="ar-txt">Todos os grupos fechados.</p>
      <button class="btn btn-yellow" onclick="arenaGerarMata()">${icon('trophy')} Gerar mata-mata</button></div>` : ''}
    ${arenaPainelDemo() && grupos.some(x => !x.fechado_em) ? `<div class="ar-botoes"><button class="btn btn-ghost btn-sm" onclick="arenaDemoResultados()">Demo: lançar resultados dos grupos</button></div>` : ''}
    <div class="ar-grupos">${grupos.map(x => arenaGrupoHtml(x, cat, g)).join('')}</div>
    ${arenaMataHtml(cat)}`);
}

async function arenaFecharGrupo(gid) {
  const grupo = ARENA.c.groups.find(x => x.id === gid);
  const { tabela, pendenteSorteio } = arClassificar(grupo);
  let sorteio = null;
  let ordem = tabela.map(l => l.team);
  if (pendenteSorteio.length) {
    // Embaralha cada bloco empatado sem critério; a ordem sorteada fica registrada no grupo.
    const sorteada = pendenteSorteio.flatMap(bloco => {
      const b = bloco.slice();
      for (let i = b.length - 1; i > 0; i--) { const j = arRandom(i + 1); [b[i], b[j]] = [b[j], b[i]]; }
      return b;
    });
    sorteio = { ordem: sorteada, observacao: 'Sorteio de desempate feito no app ao fechar o grupo' };
    ordem = arClassificar(grupo, sorteada).tabela.map(l => l.team);
  }
  const lista = `<ol class="ar-ul">${ordem.map(id => `<li>${arEsc(arDupla(arTeam(id)))}</li>`).join('')}</ol>`;
  const passo1 = await arConfirm(`Fechar Grupo ${grupo.nome}?`,
    `${sorteio ? `<p class="ar-aviso">${icon('alert')} Houve empate sem critério. O app sorteou a ordem abaixo.</p>` : ''}${lista}
     <p>Depois de fechado, nenhum placar do grupo pode ser corrigido. É o fim do prazo de protesto.</p>`, 'Continuar');
  if (!passo1) return;
  const passo2 = await arForm({
    titulo: 'Confirmação do diretor de prova',
    campos: [{ nome: 'ok', rotulo: `O diretor de prova conferiu a classificação do Grupo ${grupo.nome} e autorizou o fechamento.`, tipo: 'checkbox', obrigatorio: true }],
    ok: 'Fechar grupo', perigo: true,
  });
  if (!passo2) return;
  await arAcao(async () => {
    await arenaDb().rpc('group_close', { p_group: gid, p_sorteio: sorteio });
    await arenaRecarregar(arenaRenderChave);
  }, `Grupo ${grupo.nome} fechado.`);
}

async function arenaGerarMata() {
  const cat = ARENA.c.cats.find(c => c.id === ARENA.catId);
  const ko = ARENA.c.matches.filter(m => m.category_id === cat.id && m.fase !== 'grupo');
  const classificacoes = {};
  for (const g of arGruposCat(cat.id)) classificacoes[g.nome] = arClassificar(g).tabela.filter(l => !l.desistente);
  let slots;
  try {
    // Slots com a origem de cada vaga (o motor pode trocar vagas para evitar duelo do mesmo grupo).
    slots = BT8Championship.slotsMataMata(BT8Championship.preencherChave(ko, classificacoes));
  } catch (e) {
    return arToast(e.message, 'erro');
  }
  const porId = Object.fromEntries(ko.map(m => [m.id, m]));
  const pares = [];
  for (let i = 0; i < slots.length; i += 2) pares.push([slots[i].match, slots[i].team, slots[i + 1].team]);
  const previa = `<ul class="ar-ul">${pares.map(([id, a, b]) => `<li><b>${arEsc(arJogoNome(porId[id]))}:</b> ${arEsc(arDupla(arTeam(a)))} x ${arEsc(arDupla(arTeam(b)))}</li>`).join('')}</ul>`;
  if (!(await arConfirm('Gerar mata-mata', previa, 'Gerar'))) return;
  await arAcao(async () => {
    await arenaDb().rpc('category_seed_knockout', { p_category: cat.id, p_slots: slots });
    await arenaRecarregar(arenaRenderChave);
  }, 'Mata-mata gerado.');
}

// ══ DEMO: banco simulado no navegador (só com ?demo=1 fora de produção) ══
const AR_DEMO_KEY = 'bt8-arena-demo-v1';
let AR_DEMO_DB = null;

function arDemoDb() {
  if (!AR_DEMO_DB) {
    try { AR_DEMO_DB = JSON.parse(localStorage.getItem(AR_DEMO_KEY)); } catch { AR_DEMO_DB = null; }
    if (!AR_DEMO_DB?.arenas) AR_DEMO_DB = arDemoSeed();
  }
  return AR_DEMO_DB;
}
function arDemoSalvar() {
  try { localStorage.setItem(AR_DEMO_KEY, JSON.stringify(AR_DEMO_DB)); } catch { /* sem storage: a demo vive só nesta aba */ }
}

function arenaDemoReset() {
  AR_DEMO_DB = arDemoSeed();
  arDemoSalvar();
  ARENA.arena = null;
  ARENA.draft = {};
  APP.history = ['screen-arena'];
  document.querySelectorAll('.screen.active').forEach(el => el.classList.remove('active'));
  document.getElementById('screen-arena').classList.add('active');
  arenaIniciar();
}

function arDemoSeed() {
  const id = arUid;
  const arena = { id: id(), nome: 'Arena Demo', slug: 'arena-demo', cidade: 'Recife', estado: 'PE', status: 'ativa', plano: 'fundadora', ativo_ate: '2027-03-31', whatsapp: '+5581999990000' };
  const camp = { id: id(), arena_id: arena.id, titulo: 'Open de Verão', slug: 'open-verao-demo', data_inicio: '2026-12-11', data_fim: '2026-12-12', status: 'inscricoes', inscricao_token: arToken(), inscricoes_ate: '2026-12-08T23:59:00-03:00', live_version: 0, estrutura_version: 0 };
  camp.regras = { ...arRegrasPadrao(camp), whatsapp: '+5581999990000' };
  const cats = [
    { id: id(), championship_id: camp.id, nome: 'Masculino B', genero: 'masculino', max_duplas: 16, formato: { ...AR_FORMATO_PADRAO }, inscricoes_abertas: true, ordem: 1 },
    { id: id(), championship_id: camp.id, nome: 'Feminina C', genero: 'feminino', max_duplas: 12, formato: { ...AR_FORMATO_PADRAO }, inscricoes_abertas: true, ordem: 2 },
  ];
  const H = ['Pedro', 'Lucas', 'Rafael', 'Bruno', 'Thiago', 'Diego', 'André', 'Felipe', 'Caio', 'Igor', 'Renato', 'Marcelo', 'Gustavo', 'Vitor', 'Leandro', 'Fábio', 'Hugo', 'Danilo', 'Otávio', 'Paulo', 'Rodrigo', 'Sérgio', 'Tiago', 'Wagner', 'Yuri', 'Murilo', 'Alan', 'Breno'];
  const M = ['Ana', 'Bia', 'Carla', 'Duda', 'Elisa', 'Fernanda', 'Gabi', 'Helena', 'Isa', 'Júlia', 'Lara', 'Marina', 'Nina', 'Olívia', 'Paula', 'Rita', 'Sofia', 'Tânia'];
  const S = ['Souza', 'Lima', 'Costa', 'Melo', 'Alves', 'Rocha', 'Barros', 'Farias', 'Gomes', 'Pires', 'Queiroz', 'Teixeira'];
  const athletes = [], teams = [];
  const criar = (cat, nomes, n) => {
    for (let i = 0; i < n; i++) {
      const par = [0, 1].map(k => {
        const a = { id: id(), arena_id: arena.id, nome: `${nomes[2 * i + k]} ${S[(3 * i + k) % S.length]}`, telefone: (i + k) % 3 ? `+55819${String(80000000 + athletes.length * 7919).slice(0, 8)}` : null };
        athletes.push(a);
        return a.id;
      });
      teams.push({ id: id(), category_id: cat.id, athlete1_id: par[0], athlete2_id: par[1], status: i % 5 === 4 ? 'pendente' : 'confirmada', pagamento: i % 5 === 4 ? 'pendente' : 'nao_se_aplica', pago_em: null, acompanhamento_token: arUid(), comprovante_status: i % 10 === 4 ? 'enviado' : 'nenhum', comprovante_path: i % 10 === 4 ? 'demo' : null, seed: i < 2 ? i + 1 : null, origem: i % 2 ? 'link' : 'importacao', presente1: false, presente2: false, desistente_em: null, observacao: null });
    }
  };
  criar(cats[0], H, 14);
  criar(cats[1], M, 9);
  return {
    arenas: [arena],
    arena_members: [
      { id: id(), arena_id: arena.id, user_id: 'demo', email: 'gestor@demo.bt8', nome: 'Você (dono)', papel: 'dono', ativo: true },
      { id: id(), arena_id: arena.id, user_id: id(), email: 'scout1@demo.bt8', nome: 'Scout Quadra 1', papel: 'scout', ativo: true },
    ],
    courts: [1, 2, 3, 4].map(n => ({ id: id(), arena_id: arena.id, nome: `Quadra ${n}`, ordem: n, ativa: true })),
    championships: [camp], categories: cats, athletes, teams, category_groups: [], group_teams: [], matches: [],
  };
}

function arDemoRegras(db, tabela, linha) {
  if (tabela === 'athletes' && linha.telefone && db.athletes.some(a => a.id !== linha.id && a.arena_id === linha.arena_id && a.telefone === linha.telefone)) {
    throw new Error('Já existe atleta com esse telefone nesta arena.');
  }
  if (tabela === 'teams' && linha.status !== 'cancelada') {
    if (linha.athlete1_id === linha.athlete2_id) throw new Error('Os dois atletas da dupla precisam ser diferentes.');
    const choque = db.teams.find(t => t.id !== linha.id && t.category_id === linha.category_id && t.status !== 'cancelada'
      && [t.athlete1_id, t.athlete2_id].some(a => a === linha.athlete1_id || a === linha.athlete2_id));
    if (choque) throw new Error('Atleta já inscrito em outra dupla desta categoria.');
  }
  if (tabela === 'championships' && db.championships.some(c => c.id !== linha.id && c.slug === linha.slug)) throw new Error('Esse endereço público já está em uso.');
}

const ARENA_DEMO = {
  async select(tabela, filtro = {}, ordem) {
    const linhas = (arDemoDb()[tabela] || []).filter(r => Object.entries(filtro).every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v)));
    if (ordem) linhas.sort((a, b) => String(a[ordem] ?? '').localeCompare(String(b[ordem] ?? ''), 'pt-BR', { numeric: true }));
    return arClone(linhas);
  },
  async insert(tabela, linha) {
    const db = arDemoDb();
    const r = { id: arUid(), ...linha };
    if (tabela === 'teams') Object.assign(r, { presente1: false, presente2: false, desistente_em: null, seed: null, pago_em: null, observacao: null, ...linha });
    arDemoRegras(db, tabela, r);
    db[tabela].push(r);
    arDemoSalvar();
    return arClone(r);
  },
  async update(tabela, id, patch) {
    const db = arDemoDb();
    const r = db[tabela].find(x => x.id === id);
    if (!r) throw new Error('Registro não encontrado.');
    arDemoRegras(db, tabela, { ...r, ...patch });
    Object.assign(r, patch);
    arDemoSalvar();
    return arClone(r);
  },
  async remove(tabela, id) {
    const db = arDemoDb();
    db[tabela] = db[tabela].filter(x => x.id !== id);
    arDemoSalvar();
  },
  async rpc(nome, args) {
    const f = AR_DEMO_RPC[nome];
    if (!f) throw new Error(`RPC ${nome} não simulada na demo.`);
    const r = f(arDemoDb(), args);
    arDemoSalvar();
    return arClone(r);
  },
  async membro(p) {
    const db = arDemoDb();
    if (p.acao === 'criar') {
      if (!p.sem_conta && String(p.senha || '').length < 8) throw new Error('A senha inicial precisa de 8 ou mais caracteres.');
      if (p.email && db.arena_members.some(m => m.arena_id === p.arena_id && m.email === p.email)) throw new Error('Essa pessoa já é da equipe.');
      const member = { id: arUid(), arena_id: p.arena_id, user_id: p.sem_conta ? null : arUid(), email: p.email || null, nome: p.nome, papel: p.papel, ativo: true };
      db.arena_members.push(member);
      arDemoSalvar();
      return { ok: true, member, conta_criada: !p.sem_conta };
    }
    const m = db.arena_members.find(x => x.id === p.member_id);
    if (!m || m.papel === 'dono') throw new Error('Não é possível alterar o dono da arena.');
    for (const k of ['papel', 'ativo', 'nome']) if (p[k] !== undefined) m[k] = p[k];
    arDemoSalvar();
    return { ok: true, member: m };
  },
  async minhasArenas() {
    return arClone(arDemoDb().arenas.map(arena => ({ arena, papel: 'dono' })));
  },
  // Mesmas regras da Function arena-pagamento (transicaoPagamento em netlify/functions/lib/arena.js), sem e-mail.
  async pagamento({ team_id, acao, motivo }) {
    const db = arDemoDb();
    const t = db.teams.find(x => x.id === team_id);
    if (acao === 'ver') throw new Error('Na demonstração não há arquivo de comprovante para abrir.');
    const tem = !!t.comprovante_path;
    if (acao === 'confirmar') Object.assign(t, { pagamento: 'pago', pago_em: new Date().toISOString(), status: t.status === 'pendente' ? 'confirmada' : t.status, comprovante_status: tem ? 'aceito' : t.comprovante_status, comprovante_motivo: null });
    else if (acao === 'recusar') {
      if (String(motivo || '').trim().length < 3) throw new Error('Informe o motivo da recusa.');
      Object.assign(t, { comprovante_status: 'recusado', comprovante_motivo: motivo.trim() });
    } else if (acao === 'desfazer' && t.pagamento === 'pago') Object.assign(t, { pagamento: 'pendente', pago_em: null, status: t.status === 'confirmada' ? 'pendente' : t.status, comprovante_status: tem ? 'enviado' : 'nenhum' });
    else if (acao === 'desfazer') Object.assign(t, { comprovante_status: 'enviado', comprovante_motivo: null });
    arDemoSalvar();
    return { ok: true, team: { ...arClone(t), tem_comprovante: tem } };
  },
  async notificar({ category_id }) {
    const n = arDemoDb().teams.filter(t => t.category_id === category_id && arAtiva(t)).length;
    return { ok: true, mensagem: `Demonstração: ${n} dupla(s) seriam avisadas por e-mail.` };
  },
};

function arDemoErro(msg, hint) {
  const e = new Error(msg);
  e.hint = hint;
  return e;
}

const AR_DEMO_RPC = {
  arena_team_link(db, { p_team, p_novo }) {
    const t = db.teams.find(x => x.id === p_team);
    if (p_novo || !t.acompanhamento_token) t.acompanhamento_token = arUid();
    return { ok: true, token: t.acompanhamento_token };
  },
  category_publish_draw(db, { p_category, p_payload }) {
    const cat = db.categories.find(c => c.id === p_category);
    const doCat = db.matches.filter(m => m.category_id === p_category);
    if (doCat.some(m => m.status !== 'agendada' || m.games_a != null)) throw arDemoErro('O sorteio não pode ser refeito: a categoria já tem jogo iniciado.', 'sorteio_iniciado');
    const gIds = db.category_groups.filter(g => g.category_id === p_category).map(g => g.id);
    db.group_teams = db.group_teams.filter(x => !gIds.includes(x.group_id));
    db.category_groups = db.category_groups.filter(g => g.category_id !== p_category);
    db.matches = db.matches.filter(m => m.category_id !== p_category);
    const gid = {};
    for (const g of p_payload.grupos) {
      const novo = { id: arUid(), category_id: p_category, nome: g.nome, ordem: g.ordem, fechado_em: null, fechado_por: null, sorteio_desempate: null };
      gid[g.nome] = novo.id;
      db.category_groups.push(novo);
      for (const t of g.duplas) db.group_teams.push({ group_id: novo.id, team_id: t });
    }
    const camp = db.championships.find(c => c.id === cat.championship_id);
    const mid = Object.fromEntries(p_payload.partidas.map(p => [p.ref, arUid()]));
    const ref = o => (o?.match_ref ? { match: mid[o.match_ref] } : o || null);
    for (const p of p_payload.partidas) {
      db.matches.push({
        id: mid[p.ref], championship_id: camp.id, category_id: p_category, fase: p.fase, group_id: p.grupo ? gid[p.grupo] : null, rodada: p.rodada, slot: p.slot,
        team_a: p.team_a || null, team_b: p.team_b || null, origem_a: ref(p.origem_a), origem_b: ref(p.origem_b),
        next_match_id: p.next_ref ? mid[p.next_ref] : null, next_slot: p.next_slot || null, prioridade: p.prioridade, court_id: null, status: 'agendada',
        games_a: null, games_b: null, tb_a: null, tb_b: null, vencedor: null, wo: false, desistencia: false, alerta_origem: false, version: 1,
      });
    }
    cat.sorteio_semente = p_payload.semente;
    return { ok: true, grupos: p_payload.grupos.length, partidas: p_payload.partidas.length };
  },
  group_close(db, { p_group, p_sorteio }) {
    const g = db.category_groups.find(x => x.id === p_group);
    if (db.matches.some(m => m.group_id === p_group && !arFinal(m))) throw arDemoErro('Ainda há jogos do grupo sem resultado.', 'status_invalido');
    Object.assign(g, { fechado_em: new Date().toISOString(), fechado_por: 'demo', sorteio_desempate: p_sorteio || null });
    return { ok: true };
  },
  category_seed_knockout(db, { p_category, p_slots }) {
    if (db.category_groups.some(g => g.category_id === p_category && !g.fechado_em)) throw arDemoErro('Feche todos os grupos antes de gerar o mata-mata.', 'grupos_abertos');
    const times = p_slots.map(s => s.team);
    if (new Set(times).size !== times.length) throw arDemoErro('A mesma dupla aparece em duas vagas do mata-mata.', 'dados_invalidos');
    let n = 0;
    for (const s of p_slots) {
      const m = db.matches.find(x => x.id === s.match && x.category_id === p_category);
      if (!m || m[`origem_${s.slot}`]?.match) throw arDemoErro('Só a 1ª rodada do mata-mata pode ser preenchida.', 'dados_invalidos');
      if (m.status !== 'agendada') continue;
      m[`team_${s.slot}`] = s.team;
      if (s.origem) m[`origem_${s.slot}`] = s.origem;
      n++;
    }
    return { ok: true, preenchidos: n };
  },
  match_wo(db, { p_match, p_ausente, p_motivo }) {
    const m = db.matches.find(x => x.id === p_match);
    if (!p_motivo) throw arDemoErro('Informe o motivo.', 'motivo_obrigatorio');
    if (arFinal(m)) throw arDemoErro('A partida já terminou.', 'status_invalido');
    if (m.group_id && db.category_groups.find(g => g.id === m.group_id)?.fechado_em) throw arDemoErro('O grupo já foi fechado.', 'grupo_fechado');
    if (p_ausente === 'duplo') {
      Object.assign(m, { status: 'anulada', vencedor: null, wo: true, encerrada_em: new Date().toISOString() });
      return { ok: true, match: m };
    }
    const cat = db.categories.find(c => c.id === m.category_id);
    const f = { ...AR_FORMATO_PADRAO, ...(cat.formato || {}) };
    const alvo = (m.fase === 'grupo' ? f.preset_grupo : f.preset_mata) === 'B' ? 4 : 6;
    const presente = p_ausente === 'a' ? 'b' : 'a';
    Object.assign(m, { status: 'wo', wo: true, vencedor: m[`team_${presente}`], games_a: presente === 'a' ? alvo : 0, games_b: presente === 'b' ? alvo : 0, encerrada_em: new Date().toISOString() });
    const prox = m.next_match_id && db.matches.find(x => x.id === m.next_match_id);
    if (prox && prox.status === 'agendada') prox[`team_${m.next_slot}`] = m.vencedor;
    return { ok: true, match: m };
  },
  team_swap_athlete(db, { p_team, p_posicao, p_athlete }) {
    const t = db.teams.find(x => x.id === p_team);
    if (db.matches.some(m => (m.team_a === p_team || m.team_b === p_team) && ['em_jogo', 'suspensa', 'encerrada', 'wo'].includes(m.status))) {
      throw arDemoErro('A dupla já jogou: a troca não é mais possível.', 'dupla_ja_jogou');
    }
    const novo = { ...t, [`athlete${p_posicao}_id`]: p_athlete };
    arDemoRegras(db, 'teams', novo);
    Object.assign(t, novo);
    return { ok: true, team: t };
  },
};

// Só na demo: preenche placares aleatórios válidos (preset A) nos jogos de grupo ainda abertos da categoria.
async function arenaDemoResultados() {
  const db = arDemoDb();
  for (const m of db.matches) {
    if (m.category_id !== ARENA.catId || m.fase !== 'grupo' || arFinal(m)) continue;
    const perde = arRandom(5);
    const aVence = arRandom(2) === 0;
    Object.assign(m, { status: 'encerrada', games_a: aVence ? 6 : perde, games_b: aVence ? perde : 6, vencedor: aVence ? m.team_a : m.team_b, encerrada_em: new Date().toISOString() });
  }
  arDemoSalvar();
  await arenaRecarregar(arenaRenderChave);
  arToast('Resultados simulados lançados.');
}
