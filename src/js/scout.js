// Tela do scout (/scout). Agente A2. Entrada: openScoutRoute(), tela #screen-scout.
// O scout marca GAMES (+1/−1, tie-break no 6x6 ou 4x4) e cada toque grava o último placar numa fila
// local (só o último snapshot por partida). O envio usa match_score_push com a versão esperada;
// reenvia no evento online, ao voltar para a aba e a cada 5 s. 401 mantém o pendente.
// Login próprio nesta tela (não usa o modal do app): assim o handleAuthStateChange do auth.js não
// chama enterApp(), porque a tela ativa é #screen-scout e o modal de login está fechado.
const SC = {
  view: 'carregando', ctx: null, live: null, device: null,
  partida: null, preset: 'A', estado: null, version: null,
  enviando: false, rede: 'ok', semRedeDesde: null, aviso: null, timers: [], wakeLock: null,
};
const SC_FILA = 'bt8_scout_fila';
const SC_DEVICE = 'bt8_scout_device';

function scoutLer(chave, padrao) {
  try { const v = localStorage.getItem(chave); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; }
}
function scoutGravar(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* modo privado: segue só em memória */ }
}
const scoutMemoria = { fila: null };
function scoutFila() { return scoutMemoria.fila || (scoutMemoria.fila = scoutLer(SC_FILA, {})); }
function scoutSalvarFila() { scoutGravar(SC_FILA, scoutFila()); }
function scoutPendente(id) { return scoutFila()[id] || null; }
function scoutDescartar(id) { delete scoutFila()[id]; scoutSalvarFila(); }

function scoutDevice() {
  if (SC.device) return SC.device;
  SC.device = scoutLer(SC_DEVICE, null);
  if (!SC.device) { SC.device = arenaUuid(); scoutGravar(SC_DEVICE, SC.device); }
  return SC.device;
}

async function openScoutRoute() {
  scoutDevice();
  SC.timers.forEach(clearInterval);
  SC.timers = [setInterval(scoutTick, 1000), setInterval(() => scoutEnviar(), 5000)];
  window.addEventListener('online', () => scoutEnviar());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    scoutEnviar();
    if (SC.view === 'jogo') scoutWakeLock(true);
  });
  scoutMostrar('carregando');
  if (arenaDemoAtivo()) return scoutCarregar();
  const supa = await arenaSupaPronto();
  if (!supa) return scoutMostrar('mensagem', 'Não foi possível conectar. Recarregue a página.');
  const { data } = await supa.auth.getSession().catch(() => ({ data: null }));
  if (data?.session) scoutCarregar();
  else scoutMostrar('login');
}

// ── Telas ──────────────────────────────────────────────────
function scoutMostrar(view, msg) {
  SC.view = view;
  if (view !== 'jogo') scoutWakeLock(false);
  const el = document.getElementById('screen-scout');
  const topo = `<header class="sc-top">
    <div class="sc-top-titulo">${escapeHtml(SC.ctx?.titulo || 'Scout BT8')}</div>
    <div class="sc-rede" id="sc-rede"></div>
  </header>`;
  if (view === 'carregando') el.innerHTML = `<div class="sc">${topo}<p class="sc-msg">Carregando…</p></div>`;
  if (view === 'mensagem') {
    el.innerHTML = `<div class="sc">${topo}<p class="sc-msg">${escapeHtml(msg)}</p>
      <button class="sc-btn" onclick="scoutVoltarLista()">Voltar às quadras</button></div>`;
  }
  if (view === 'login') {
    el.innerHTML = `<div class="sc">${topo}
      <form class="sc-login" onsubmit="scoutEntrar(event)">
        <p>${escapeHtml(msg || 'Entre com o login que o gestor da arena criou para você.')}</p>
        <label>E-mail<input name="email" type="email" autocomplete="username" required></label>
        <label>Senha<input name="senha" type="password" autocomplete="current-password" required></label>
        <p class="sc-erro" id="sc-login-erro" role="alert"></p>
        <button class="sc-btn" type="submit">Entrar</button>
      </form></div>`;
  }
  if (view === 'outro') {
    el.innerHTML = `<div class="sc">${topo}<div class="sc-alerta">
      <b>Outro aparelho assumiu esta partida.</b>
      <p>Os toques que ainda não tinham sido enviados daqui foram descartados.</p></div>
      <button class="sc-btn" onclick="scoutVoltarLista()">Voltar às quadras</button></div>`;
  }
  if (view === 'lista') el.innerHTML = `<div class="sc">${topo}<div id="sc-lista"></div>
    <button class="sc-sair" onclick="scoutSair()">Sair</button></div>`;
  if (view === 'jogo') {
    el.innerHTML = `<div class="sc sc-jogo">${topo}<div id="sc-jogo"></div></div>`;
    scoutWakeLock(true);
  }
  scoutTick();
  if (view === 'lista') scoutRenderLista();
  if (view === 'jogo') scoutRenderJogo();
}

async function scoutEntrar(ev) {
  ev.preventDefault();
  const f = ev.target;
  const erro = document.getElementById('sc-login-erro');
  erro.textContent = '';
  const supa = await arenaSupaPronto();
  const { error } = await supa.auth.signInWithPassword({ email: f.elements.email.value.trim(), password: f.elements.senha.value });
  if (error) {
    erro.textContent = /invalid login/i.test(error.message) ? 'E-mail ou senha incorretos.' : 'Não foi possível entrar. Confira a internet e tente de novo.';
    return;
  }
  if (SC.partida) { // voltou de um 401 no meio do jogo: reenvia o pendente e continua
    scoutMostrar('jogo');
    return scoutEnviar();
  }
  scoutCarregar();
}

async function scoutSair() {
  const supa = await arenaSupaPronto();
  if (supa) await supa.auth.signOut().catch(() => {});
  Object.assign(SC, { ctx: null, partida: null, live: null });
  scoutMostrar('login');
}

// ── Contexto: campeonato em andamento da arena do scout ────
async function scoutCarregar() {
  scoutMostrar('carregando');
  try {
    let slug = 'demo';
    if (!arenaDemoAtivo()) {
      const supa = await arenaSupaPronto();
      const { data: user } = await supa.auth.getUser();
      const { data: membros, error: e1 } = await supa.from('arena_members').select('arena_id').eq('user_id', user?.user?.id).eq('ativo', true);
      if (e1) throw e1;
      if (!membros?.length) return scoutMostrar('mensagem', 'Sua conta não faz parte da equipe de nenhuma arena.');
      const { data: camps, error: e2 } = await supa.from('championships').select('slug, titulo, status, data_inicio')
        .in('arena_id', membros.map(m => m.arena_id)).in('status', ['em_andamento', 'inscricoes']).order('data_inicio');
      if (e2) throw e2;
      const camp = (camps || []).find(c => c.status === 'em_andamento') || (camps || [])[0];
      if (!camp) return scoutMostrar('mensagem', 'Nenhum campeonato em andamento na sua arena.');
      slug = camp.slug;
    }
    const pub = await arenaRpc('arena_public', { p_slug: slug });
    if (pub.ok === false) return scoutMostrar('mensagem', 'Campeonato não encontrado.');
    SC.ctx = { slug, titulo: pub.championship.titulo, categorias: pub.categorias || [] };
    scoutVoltarLista();
  } catch (e) {
    if (e.status === 401) return scoutMostrar('login', 'Sua sessão expirou. Entre de novo.');
    scoutMostrar('mensagem', e.status === 0 ? 'Sem conexão. Tente de novo quando a internet voltar.' : (e.message || 'Erro ao carregar.'));
  }
}

// ── Lista de quadras ───────────────────────────────────────
function scoutVoltarLista() {
  SC.partida = null;
  if (!SC.ctx) return scoutCarregar();
  scoutMostrar('lista');
  scoutAtualizarLista();
}

async function scoutAtualizarLista() {
  if (SC.view !== 'lista') return;
  try {
    const r = await arenaRpc('arena_live', { p_slug: SC.ctx.slug, p_since: SC.live?.championship?.live_version ?? null });
    if (r.ok !== false && r.changed !== false) SC.live = r;
    scoutRenderLista();
  } catch (e) {
    const el = document.getElementById('sc-lista');
    if (el && !SC.live) el.innerHTML = '<p class="sc-msg">Sem conexão. Tentando de novo…</p>';
  }
  clearTimeout(SC.listaTimer);
  SC.listaTimer = setTimeout(scoutAtualizarLista, 5000);
}

function scoutRenderLista() {
  const el = document.getElementById('sc-lista');
  if (!el || !SC.live) return;
  const quadras = (SC.live.quadras || []).filter(q => q.ativa !== false).sort((x, y) => x.ordem - y.ordem);
  const partidas = SC.live.partidas || [];
  const pausa = SC.live.championship?.pausado ? `<div class="sc-alerta">PAUSA – ${escapeHtml(SC.live.championship.pausa_motivo || 'evento pausado')}</div>` : '';
  const pendentes = Object.keys(scoutFila()).length;
  el.innerHTML = pausa + (pendentes ? `<div class="sc-alerta ambar">${pendentes} placar(es) aguardando envio.</div>` : '') +
    quadras.map(q => {
      const p = partidas.find(x => x.court_id === q.id && x.status === 'em_jogo') || partidas.find(x => x.court_id === q.id);
      if (!p) return `<div class="sc-quadra"><div class="sc-quadra-nome">${escapeHtml(q.nome)}</div><div class="sc-livre">Livre</div></div>`;
      return `<div class="sc-quadra">
        <div class="sc-quadra-nome">${escapeHtml(q.nome)} <span class="sc-selo ${p.status}">${p.status === 'em_jogo' ? 'Em jogo' : 'Chamada'}</span></div>
        <div class="sc-quadra-cat">${escapeHtml(p.categoria || '')}${p.grupo ? ' · Grupo ' + escapeHtml(p.grupo) : ''}</div>
        <div class="sc-quadra-duplas">${escapeHtml(p.team_a?.nome)} <b>${p.games_a ?? 0} x ${p.games_b ?? 0}</b> ${escapeHtml(p.team_b?.nome)}</div>
        <button class="sc-btn" onclick="scoutAssumir('${escapeHtml(p.id)}')">Assumir partida</button>
      </div>`;
    }).join('') || '<p class="sc-msg">Nenhuma quadra cadastrada.</p>';
}

async function scoutAssumir(id) {
  const resumo = (SC.live?.partidas || []).find(p => p.id === id);
  try {
    const r = await arenaRpc('match_take', { p_match: id, p_device: scoutDevice() }, { auth: true });
    const m = r.match;
    const cat = SC.ctx.categorias.find(c => c.id === m.category_id) || {};
    const formato = cat.formato || {};
    SC.preset = (m.fase === 'grupo' ? formato.preset_grupo : formato.preset_mata) || 'A';
    SC.partida = { ...m, nome_a: resumo?.team_a?.nome || 'Dupla A', nome_b: resumo?.team_b?.nome || 'Dupla B',
      categoria: resumo?.categoria || cat.nome || '', quadra: (SC.live?.quadras || []).find(q => q.id === m.court_id)?.nome || '' };
    SC.version = m.version;
    // O reserva começa pelo placar do servidor; só um pendente deste mesmo aparelho continua valendo.
    const pend = scoutPendente(id);
    SC.estado = pend ? BT8Scoring.dePlacarServidor(pend.placar, SC.preset) : BT8Scoring.dePlacarServidor(m, SC.preset);
    SC.aviso = null;
    scoutMostrar('jogo');
    if (pend) scoutEnviar();
  } catch (e) {
    if (e.status === 401) return scoutMostrar('login', 'Sua sessão expirou. Entre de novo.');
    alert(e.status === 0 ? 'Sem conexão: não deu para assumir a partida.' : e.message);
  }
}

// ── Jogo ───────────────────────────────────────────────────
function scoutRenderJogo() {
  const el = document.getElementById('sc-jogo');
  if (!el || !SC.partida) return;
  const e = SC.estado, p = SC.partida;
  const tb = BT8Scoring.emTieBreak(e, SC.preset);
  const fim = BT8Scoring.fim(e, SC.preset);
  const final = fim ? BT8Scoring.paraPlacarFinal(e, SC.preset) : null;
  // Saque no tie-break: 1 de quem abre, depois 2 de cada (1-2-2). O scout marca quem sacou o 1º ponto.
  const primeiro = scoutPrimeiroSaque(p.id);
  const saca = tb && !fim ? BT8Scoring.sacaNoTieBreak(e, primeiro) : null;
  const lado = (l, nome) => `<div class="sc-lado${saca === l ? ' sc-sacando' : ''}">
    <div class="sc-nome">${escapeHtml(nome)}</div>
    <div class="sc-games">${e['games_' + l]}</div>
    ${tb ? `<div class="sc-tb">Tie-break <b>${e['tb_' + l] ?? 0}</b></div>` : ''}
    ${saca ? `<div class="sc-saque">${saca === l ? '● Saca agora' : '&nbsp;'}</div>` : ''}
    <button class="sc-mais" onclick="scoutTocar('${l}', 1)" ${fim ? 'disabled' : ''} aria-label="Mais um ${tb ? 'ponto de tie-break' : 'game'} para ${escapeHtml(nome)}">+1 ${tb ? 'ponto' : 'game'}</button>
    <button class="sc-menos" onclick="scoutTocar('${l}', -1)" aria-label="Tirar um ${tb ? 'ponto' : 'game'} de ${escapeHtml(nome)}">−1</button>
  </div>`;
  el.innerHTML = `
    <div class="sc-jogo-meta">${escapeHtml(p.quadra)} · ${escapeHtml(p.categoria)} · preset ${SC.preset}</div>
    ${SC.aviso ? `<div class="sc-alerta">${escapeHtml(SC.aviso)} <button onclick="SC.aviso=null;scoutRenderJogo()">Continuar daqui</button></div>` : ''}
    ${tb && !fim ? `<div class="sc-saque-escolha" role="group" aria-label="Quem sacou o primeiro ponto do tie-break">
      <span>1º saque do tie-break:</span>
      <button class="${primeiro === 'a' ? 'on' : ''}" aria-pressed="${primeiro === 'a'}" onclick="scoutDefinirSaque('a')">${escapeHtml(p.nome_a)}</button>
      <button class="${primeiro === 'b' ? 'on' : ''}" aria-pressed="${primeiro === 'b'}" onclick="scoutDefinirSaque('b')">${escapeHtml(p.nome_b)}</button>
    </div>` : ''}
    <div class="sc-placar">${lado('a', p.nome_a)}${lado('b', p.nome_b)}</div>
    ${final ? `<button class="sc-btn sc-fim" onclick="scoutEncerrar()">Confirmar ${final.games_a}x${final.games_b}${final.tb_a != null ? ` (${final.tb_a}-${final.tb_b})` : ''}?</button>` : ''}
    <button class="sc-sair" onclick="scoutVoltarLista()">Voltar às quadras</button>`;
}

// Quem sacou o 1º ponto do tie-break, por partida (padrão: dupla A). Fica no aparelho.
function scoutPrimeiroSaque(id) { return scoutLer('bt8_scout_saque', {})[id] || 'a'; }
function scoutDefinirSaque(lado) {
  const mapa = scoutLer('bt8_scout_saque', {});
  mapa[SC.partida.id] = lado;
  scoutGravar('bt8_scout_saque', mapa);
  scoutRenderJogo();
}

function scoutTocar(lado, delta) {
  const novo = BT8Scoring.marcar(SC.estado, lado, delta, SC.preset);
  if (JSON.stringify(novo) === JSON.stringify(SC.estado)) return;
  SC.estado = novo;
  SC.aviso = null;
  scoutFila()[SC.partida.id] = { placar: BT8Scoring.paraServidor(novo, SC.preset), client_event_id: arenaUuid(), em: Date.now() };
  scoutSalvarFila();
  if (navigator.vibrate) navigator.vibrate(15);
  scoutRenderJogo();
  scoutEnviar();
}

// Envia o pendente da partida aberta (um envio por vez; toques durante o envio saem logo depois).
async function scoutEnviar() {
  const p = SC.partida;
  if (!p || SC.enviando) return;
  const pend = scoutPendente(p.id);
  if (!pend) { SC.rede = 'ok'; SC.semRedeDesde = null; return; }
  SC.enviando = true;
  let r;
  try {
    r = await arenaRpc('match_score_push', {
      p_match: p.id, p_expected_version: SC.version, p_client_event_id: pend.client_event_id, p_device: scoutDevice(),
      p_games_a: pend.placar.games_a, p_games_b: pend.placar.games_b, p_tb_a: pend.placar.tb_a, p_tb_b: pend.placar.tb_b,
    }, { auth: true });
  } catch (e) {
    SC.enviando = false;
    SC.rede = e.status === 401 ? 'login' : 'offline';
    if (!SC.semRedeDesde) SC.semRedeDesde = Date.now();
    scoutTick();
    if (e.status === 401 && SC.view === 'jogo') scoutMostrar('login', 'Sua sessão expirou. Entre de novo: o placar pendente continua guardado.');
    return;
  }
  SC.enviando = false;
  scoutResposta(r, pend);
  if (SC.partida && scoutPendente(SC.partida.id)) scoutEnviar(); // houve toque durante o envio
}

function scoutResposta(r, pend) {
  const id = SC.partida.id;
  const enviadoAinda = () => scoutPendente(id)?.client_event_id === pend.client_event_id;
  if (r.ok) {
    SC.version = r.match.version;
    if (enviadoAinda()) scoutDescartar(id);
    SC.rede = 'ok';
    SC.semRedeDesde = null;
  } else if (r.erro === 'conflito') {
    // A Mesa (ou outro envio) mudou o placar: o servidor manda, e a fila local desta partida é descartada.
    SC.version = r.version ?? r.match?.version;
    SC.estado = BT8Scoring.dePlacarServidor(r.placar || r.match, SC.preset);
    scoutDescartar(id);
    const pl = r.placar || r.match;
    SC.aviso = r.por === 'mesa' ? `Placar ajustado pela Mesa: ${pl.games_a}x${pl.games_b}.` : `Placar atualizado no servidor: ${pl.games_a}x${pl.games_b}.`;
    SC.rede = 'ok';
  } else if (r.erro === 'outro_aparelho') {
    scoutDescartar(id);
    SC.partida = null;
    return scoutMostrar('outro');
  } else if (r.erro === 'partida_encerrada') {
    scoutDescartar(id);
    SC.partida = null;
    return scoutMostrar('mensagem', 'Esta partida já foi encerrada pela Mesa.');
  } else if (r.erro === 'partida_indisponivel') {
    scoutDescartar(id);
    SC.partida = null;
    return scoutMostrar('mensagem', 'A partida foi suspensa ou ainda não foi chamada. Aguarde a Mesa chamar de novo.');
  }
  scoutTick();
  if (SC.view === 'jogo') scoutRenderJogo();
}

async function scoutEncerrar() {
  const final = BT8Scoring.paraPlacarFinal(SC.estado, SC.preset);
  if (!final) return;
  // Primeiro garante que o servidor tem o placar final (espera um envio que já esteja em andamento).
  for (let i = 0; i < 40 && SC.partida && scoutPendente(SC.partida.id); i++) {
    if (SC.enviando) { await new Promise(ok => setTimeout(ok, 250)); continue; }
    await scoutEnviar();
    if (SC.rede !== 'ok') break;
  }
  if (!SC.partida || SC.view !== 'jogo') return;
  if (scoutPendente(SC.partida.id)) {
    SC.aviso = 'Sem rede: o placar final ainda não chegou ao servidor. Tente encerrar de novo em instantes.';
    return scoutRenderJogo();
  }
  try {
    const r = await arenaRpc('match_finish', { p_match: SC.partida.id, p_version: SC.version, p_vencedor: final.vencedor, p_device: scoutDevice() }, { auth: true });
    if (r.ok) {
      const p = SC.partida;
      SC.partida = null;
      return scoutMostrar('mensagem', `Partida encerrada: ${p.nome_a} ${final.games_a}x${final.games_b} ${p.nome_b}.`);
    }
    scoutResposta(r, { client_event_id: null });
  } catch (e) {
    if (e.status === 401) return scoutMostrar('login', 'Sua sessão expirou. Entre de novo.');
    SC.aviso = e.status === 0 ? 'Sem rede. Tente encerrar de novo em instantes.' : e.message;
    scoutRenderJogo();
  }
}

// ── Indicador de rede e Wake Lock ──────────────────────────
function scoutTick() {
  const el = document.getElementById('sc-rede');
  if (!el) return;
  const pend = SC.partida && scoutPendente(SC.partida.id);
  let classe = 'ok', texto = 'enviado';
  if (SC.rede === 'login') { classe = 'erro'; texto = 'entre de novo'; }
  else if (pend && SC.semRedeDesde && SC.rede === 'offline') {
    classe = 'erro';
    texto = `sem rede há ${Math.max(1, Math.round((Date.now() - SC.semRedeDesde) / 1000))}s`;
  } else if (pend) { classe = 'pendente'; texto = 'pendente'; }
  else if (!navigator.onLine) { classe = 'erro'; texto = 'sem rede'; }
  el.className = 'sc-rede ' + classe;
  el.textContent = texto;
}

async function scoutWakeLock(ligar) {
  try {
    if (ligar && 'wakeLock' in navigator && !SC.wakeLock) {
      SC.wakeLock = await navigator.wakeLock.request('screen');
      SC.wakeLock.addEventListener('release', () => { SC.wakeLock = null; });
    } else if (!ligar && SC.wakeLock) {
      await SC.wakeLock.release();
      SC.wakeLock = null;
    }
  } catch (e) { /* sem suporte ou sem permissão: segue sem */ }
}
