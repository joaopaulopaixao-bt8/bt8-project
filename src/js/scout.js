// Tela do scout (/scout). Agente A2. Entrada: openScoutRoute(), tela #screen-scout.
// O scout marca GAMES (+1/−1, tie-break no 6x6 ou 4x4) e cada toque grava o último placar da partida
// numa fila local (um snapshot por partida, com a versão do servidor que ele conhecia). O envio usa
// match_score_push com a versão esperada; os pendentes de TODAS as partidas são reenviados no evento
// online, ao voltar para a aba e a cada 5 s. 401 mantém o pendente; sem rede, nem pede login.
// Login próprio nesta tela (não usa o modal do app): assim o handleAuthStateChange do auth.js não
// chama enterApp(), porque a tela ativa é #screen-scout e o modal de login está fechado.
const SC = {
  view: 'carregando', ctx: null, live: null, device: null,
  partida: null, preset: 'A', estado: null, version: null,
  enviando: false, rede: 'ok', semRedeDesde: null, aviso: null, oferta: null, encerrando: false,
  listaOcupada: false, timers: [], wakeLock: null,
};
const SC_FILA = 'bt8_scout_fila';
const SC_DEVICE = 'bt8_scout_device';

function scoutLer(chave, padrao) {
  try { const v = localStorage.getItem(chave); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; }
}
function scoutGravar(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* modo privado: segue só em memória */ }
}
// Fila: { [matchId]: { placar, client_event_id, em, versao, pausado? } }.
// versao = versão do servidor que este aparelho conhecia quando gravou o placar.
// pausado = pendente antigo esperando o scout decidir se usa (depois de assumir de novo).
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

const scoutEspera = ms => new Promise(ok => setTimeout(ok, ms));
const scoutTexto = p => `${p.games_a}x${p.games_b}${p.tb_a != null || p.tb_b != null ? ` (${p.tb_a ?? 0}-${p.tb_b ?? 0})` : ''}`;

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
  SC.rede = 'ok';
  if (SC.partida) { // voltou de um 401 no meio do jogo: reenvia o pendente e continua
    scoutMostrar('jogo');
    return scoutEnviar();
  }
  scoutCarregar();
  scoutEnviar();
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
  SC.oferta = null;
  if (!SC.ctx) return scoutCarregar();
  scoutMostrar('lista');
  scoutAtualizarLista();
}

async function scoutAtualizarLista() {
  if (SC.view !== 'lista' || SC.listaOcupada) return; // uma chamada por vez
  SC.listaOcupada = true;
  try {
    const r = await arenaRpc('arena_live', { p_slug: SC.ctx.slug, p_since: SC.live?.championship?.live_version ?? null });
    if (r.ok !== false && r.changed !== false && arenaAceita(SC.live, r, 'live_version')) SC.live = r;
    scoutRenderLista();
  } catch (e) {
    const el = document.getElementById('sc-lista');
    if (el && !SC.live) el.innerHTML = '<p class="sc-msg">Sem conexão. Tentando de novo…</p>';
  } finally {
    SC.listaOcupada = false;
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

// Assumir SEMPRE começa pelo placar do servidor (contrato 4.1). Um pendente antigo deste aparelho só é
// oferecido ("você tinha 4x3 não enviado, usar?") se o servidor não avançou desde aquele placar.
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
    SC.estado = BT8Scoring.dePlacarServidor(m, SC.preset);
    SC.aviso = null;
    SC.oferta = null;
    const pend = scoutPendente(id);
    if (pend) {
      const igual = JSON.stringify(pend.placar) === JSON.stringify(BT8Scoring.paraServidor(SC.estado, SC.preset));
      // match_take soma 1 à versão: sem nenhuma outra mudança, a versão é a que o pendente conhecia + 1.
      const servidorParado = pend.versao != null && m.version <= pend.versao + 1;
      if (!igual && servidorParado) {
        pend.pausado = true;
        scoutSalvarFila();
        SC.oferta = pend.placar;
      } else {
        scoutDescartar(id);
        if (!igual) SC.aviso = `O placar ${scoutTexto(pend.placar)} não enviado daqui foi descartado: o servidor já tinha um placar mais novo.`;
      }
    }
    scoutMostrar('jogo');
  } catch (e) {
    if (e.status === 401) return scoutMostrar('login', 'Sua sessão expirou. Entre de novo.');
    alert(e.status === 0 ? 'Sem conexão: não deu para assumir a partida.' : e.message);
  }
}

function scoutUsarPendente() {
  const pend = scoutPendente(SC.partida.id);
  SC.oferta = null;
  if (!pend) return scoutRenderJogo();
  SC.estado = BT8Scoring.dePlacarServidor(pend.placar, SC.preset);
  Object.assign(pend, { versao: SC.version, client_event_id: arenaUuid(), pausado: false });
  scoutSalvarFila();
  scoutRenderJogo();
  scoutEnviar();
}

function scoutDescartarOferta() {
  scoutDescartar(SC.partida.id);
  SC.oferta = null;
  scoutRenderJogo();
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
    <button class="sc-mais" onclick="scoutTocar('${l}', 1)" ${fim || SC.encerrando ? 'disabled' : ''} aria-label="Mais um ${tb ? 'ponto de tie-break' : 'game'} para ${escapeHtml(nome)}">+1 ${tb ? 'ponto' : 'game'}</button>
    <button class="sc-menos" onclick="scoutTocar('${l}', -1)" ${SC.encerrando ? 'disabled' : ''} aria-label="Tirar um ${tb ? 'ponto' : 'game'} de ${escapeHtml(nome)}">−1</button>
  </div>`;
  el.innerHTML = `
    <div class="sc-jogo-meta">${escapeHtml(p.quadra)} · ${escapeHtml(p.categoria)} · preset ${SC.preset}</div>
    ${SC.oferta ? `<div class="sc-alerta ambar">Você tinha ${escapeHtml(scoutTexto(SC.oferta))} não enviado neste aparelho. O servidor está em ${escapeHtml(scoutTexto(BT8Scoring.paraServidor(e, SC.preset)))}. Usar o seu?
      <div class="sc-oferta"><button onclick="scoutUsarPendente()">Usar ${escapeHtml(scoutTexto(SC.oferta))}</button>
      <button onclick="scoutDescartarOferta()">Manter o do servidor</button></div></div>` : ''}
    ${SC.aviso ? `<div class="sc-alerta">${escapeHtml(SC.aviso)} <button onclick="SC.aviso=null;scoutRenderJogo()">Continuar daqui</button></div>` : ''}
    ${tb && !fim ? `<div class="sc-saque-escolha" role="group" aria-label="Quem sacou o primeiro ponto do tie-break">
      <span>1º saque do tie-break:</span>
      <button class="${primeiro === 'a' ? 'on' : ''}" aria-pressed="${primeiro === 'a'}" onclick="scoutDefinirSaque('a')">${escapeHtml(p.nome_a)}</button>
      <button class="${primeiro === 'b' ? 'on' : ''}" aria-pressed="${primeiro === 'b'}" onclick="scoutDefinirSaque('b')">${escapeHtml(p.nome_b)}</button>
    </div>` : ''}
    <div class="sc-placar">${lado('a', p.nome_a)}${lado('b', p.nome_b)}</div>
    ${final ? `<button class="sc-btn sc-fim" onclick="scoutEncerrar()" ${SC.encerrando ? 'disabled' : ''}>${SC.encerrando ? 'Encerrando…' : `Confirmar ${escapeHtml(scoutTexto(final))}?`}</button>` : ''}
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
  if (SC.encerrando) return;
  const novo = BT8Scoring.marcar(SC.estado, lado, delta, SC.preset);
  if (JSON.stringify(novo) === JSON.stringify(SC.estado)) return;
  SC.estado = novo;
  SC.aviso = null;
  SC.oferta = null; // tocar no placar do servidor descarta o pendente antigo oferecido
  scoutFila()[SC.partida.id] = { placar: BT8Scoring.paraServidor(novo, SC.preset), client_event_id: arenaUuid(), em: Date.now(), versao: SC.version };
  scoutSalvarFila();
  if (navigator.vibrate) navigator.vibrate(15);
  scoutRenderJogo();
  scoutEnviar();
}

// Próximo pendente a enviar: o da partida aberta primeiro, depois os demais (menos os em espera de decisão).
function scoutProximoPendente() {
  const fila = scoutFila();
  const ids = Object.keys(fila).filter(id => !fila[id].pausado);
  const aberta = SC.partida?.id;
  return ids.includes(aberta) ? aberta : ids[0] || null;
}

// Envia os pendentes de todas as partidas, um por vez. Toques durante um envio saem logo depois.
async function scoutEnviar() {
  if (SC.enviando) return;
  SC.enviando = true;
  try {
    for (let guarda = 0; guarda < 50; guarda++) {
      const id = scoutProximoPendente();
      if (!id) { SC.rede = 'ok'; SC.semRedeDesde = null; break; }
      const pend = scoutPendente(id);
      let r;
      try {
        r = await arenaRpc('match_score_push', {
          p_match: id, p_expected_version: pend.versao ?? null, p_client_event_id: pend.client_event_id, p_device: scoutDevice(),
          p_games_a: pend.placar.games_a, p_games_b: pend.placar.games_b, p_tb_a: pend.placar.tb_a, p_tb_b: pend.placar.tb_b,
        }, { auth: true });
      } catch (e) {
        if (scoutFalhaEnvio(id, e)) continue;
        break;
      }
      SC.rede = 'ok';
      SC.semRedeDesde = null;
      scoutRespostaPush(id, pend, r);
    }
  } finally {
    SC.enviando = false;
    scoutTick();
  }
}

// Falha de envio. Devolve true quando o laço pode seguir para o próximo pendente.
function scoutFalhaEnvio(id, e) {
  if (e.status === 0) {
    // Sem rede ou tempo esgotado (inclusive login vencido que não renova sem rede): guarda e tenta depois.
    SC.rede = e.hint === 'token_sem_rede' ? 'login_offline' : 'offline';
    if (!SC.semRedeDesde) SC.semRedeDesde = Date.now();
    return false;
  }
  if (e.status === 401) {
    // Há rede e o login não vale mais: pede login sem perder o pendente.
    SC.rede = 'login';
    if (SC.view === 'jogo' || SC.view === 'lista') scoutMostrar('login', 'Sua sessão expirou. Entre de novo: os placares pendentes continuam guardados.');
    return false;
  }
  if (e.status >= 400 && e.status < 500) {
    // Recusa de regra (sem permissão, dados inválidos): reenviar não resolve.
    scoutDescartar(id);
    if (SC.partida?.id === id) { SC.aviso = e.message; scoutRenderJogo(); }
    return true;
  }
  SC.rede = 'offline'; // 5xx: tenta de novo depois
  if (!SC.semRedeDesde) SC.semRedeDesde = Date.now();
  return false;
}

function scoutRespostaPush(id, pend, r) {
  const aberta = SC.partida?.id === id;
  const atual = scoutPendente(id);
  if (r.ok) {
    const v = r.match.version;
    if (atual?.client_event_id === pend.client_event_id) scoutDescartar(id);
    else if (atual) { atual.versao = v; scoutSalvarFila(); } // houve toque durante o envio
    if (aberta) SC.version = v;
  } else if (r.erro === 'conflito') {
    const v = r.version ?? r.match?.version;
    const pl = r.placar || r.match;
    if (r.por !== 'mesa' && r.por !== 'arbitro' && atual) {
      // Conflito com um envio nosso cuja resposta se perdeu: o servidor tem um placar mais velho deste
      // scout e o local é o mais novo. Adota a versão e reenvia o placar local.
      atual.versao = v;
      scoutSalvarFila();
      if (aberta) SC.version = v;
    } else {
      // A Mesa (ou o árbitro) mudou o placar: o servidor manda e o pendente desta partida é descartado.
      scoutDescartar(id);
      if (aberta) {
        SC.version = v;
        SC.estado = BT8Scoring.dePlacarServidor(pl, SC.preset);
        SC.aviso = `Placar ajustado pela Mesa: ${scoutTexto(pl)}.`;
      }
    }
  } else if (r.erro === 'outro_aparelho') {
    scoutDescartar(id);
    if (aberta) { SC.partida = null; return scoutMostrar('outro'); }
  } else if (r.erro === 'partida_encerrada') {
    scoutDescartar(id);
    if (aberta) { SC.partida = null; return scoutMostrar('mensagem', 'Esta partida já foi encerrada pela Mesa.'); }
  } else if (r.erro === 'partida_indisponivel') {
    scoutDescartar(id);
    if (aberta) { SC.partida = null; return scoutMostrar('mensagem', 'A partida foi suspensa ou ainda não foi chamada. Aguarde a Mesa chamar de novo.'); }
  }
  scoutTick();
  if (aberta && SC.view === 'jogo') scoutRenderJogo();
}

// Encerrar: envia o pendente, recalcula o placar final DEPOIS do envio e só chama match_finish se for o
// mesmo placar que o scout confirmou na tela. Botão travado contra toque duplo.
async function scoutEncerrar() {
  if (SC.encerrando || !SC.partida) return;
  const visto = BT8Scoring.paraPlacarFinal(SC.estado, SC.preset);
  if (!visto) return;
  const id = SC.partida.id;
  SC.encerrando = true;
  scoutRenderJogo();
  try {
    for (let i = 0; i < 40 && SC.partida?.id === id && scoutPendente(id) && !scoutPendente(id).pausado; i++) {
      if (SC.enviando) { await scoutEspera(250); continue; }
      await scoutEnviar();
      if (SC.rede !== 'ok') break;
    }
    if (SC.partida?.id !== id || SC.view !== 'jogo') return;
    if (scoutPendente(id)) {
      SC.aviso = 'Sem rede: o placar final ainda não chegou ao servidor. Tente encerrar de novo em instantes.';
      return;
    }
    const final = BT8Scoring.paraPlacarFinal(SC.estado, SC.preset);
    if (!final || JSON.stringify(final) !== JSON.stringify(visto)) {
      SC.aviso = SC.aviso || `O placar mudou para ${scoutTexto(BT8Scoring.paraServidor(SC.estado, SC.preset))}. Confira antes de encerrar.`;
      return;
    }
    let r;
    try {
      r = await arenaRpc('match_finish', { p_match: id, p_version: SC.version, p_vencedor: final.vencedor, p_device: scoutDevice() }, { auth: true });
    } catch (e) {
      if (e.status === 401) { SC.rede = 'login'; return scoutMostrar('login', 'Sua sessão expirou. Entre de novo.'); }
      SC.aviso = e.status === 0 ? 'Sem rede. Tente encerrar de novo em instantes.' : e.message;
      return;
    }
    const mesmoPlacar = m => m && m.games_a === final.games_a && m.games_b === final.games_b &&
      (m.tb_a ?? null) === (final.tb_a ?? null) && (m.tb_b ?? null) === (final.tb_b ?? null);
    // Já encerrada com este placar = a resposta do encerramento anterior se perdeu: é sucesso.
    if (r.ok || (r.erro === 'partida_encerrada' && mesmoPlacar(r.match))) {
      const p = SC.partida;
      scoutDescartar(id);
      SC.partida = null;
      return scoutMostrar('mensagem', `Partida encerrada: ${p.nome_a} ${scoutTexto(final)} ${p.nome_b}.`);
    }
    if (r.erro === 'conflito') {
      const pl = r.placar || r.match;
      SC.version = r.version ?? r.match?.version;
      SC.estado = BT8Scoring.dePlacarServidor(pl, SC.preset);
      SC.aviso = `O placar no servidor é ${scoutTexto(pl)}. Confira e confirme de novo.`;
      return;
    }
    scoutRespostaPush(id, { client_event_id: null }, r);
  } finally {
    SC.encerrando = false;
    if (SC.view === 'jogo') scoutRenderJogo();
  }
}

// ── Indicador de rede e Wake Lock ──────────────────────────
function scoutTick() {
  const el = document.getElementById('sc-rede');
  if (!el) return;
  const pendentes = Object.keys(scoutFila()).length;
  const segundos = () => Math.max(1, Math.round((Date.now() - (SC.semRedeDesde || Date.now())) / 1000));
  let classe = 'ok', texto = 'enviado';
  if (SC.rede === 'login') { classe = 'erro'; texto = 'entre de novo'; }
  else if (SC.rede === 'login_offline') { classe = 'erro'; texto = `sem rede há ${segundos()}s · entre de novo quando a rede voltar`; }
  else if (pendentes && SC.rede === 'offline') { classe = 'erro'; texto = `sem rede há ${segundos()}s`; }
  else if (pendentes) { classe = 'pendente'; texto = 'pendente'; }
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
