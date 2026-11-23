// Página pública e inscrição. Agente A2. Entradas: openPublicoRoute(slug) em #screen-publico (/c/<slug>),
// openInscricaoRoute(token) em #screen-inscricao (/inscricao/<token>).
// Este arquivo também traz a camada de API da arena e o modo demo, usados por scout.js e telao.js
// (os três são carregados antes do DOMContentLoaded; o contrato está em docs/ARENA.md).

// ══ API DA ARENA ═══════════════════════════════════════════
const ARENA_TIMEOUT_MS = 8000;
const ARENA_FUSO = 'America/Sao_Paulo';

// ?demo=1 usa dados simulados em memória, só em host local ou build fora de produção (mesma regra do painel).
// Assim o *.netlify.app de produção (APP_ENV = production) nunca liga o demo.
function arenaDemoAtivo() {
  try {
    const h = location.hostname;
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(h) || /\.(localhost|test)$/.test(h);
    return new URLSearchParams(location.search).get('demo') === '1' && (local || (window.BT8_ENV?.APP_ENV || 'production') !== 'production');
  } catch (e) { return false; }
}

// fetch com limite de ~8 s: estourar conta como falta de rede (status 0) e libera quem espera a resposta.
async function arenaFetch(url, init, limiteMs = ARENA_TIMEOUT_MS) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), limiteMs) : null;
  try {
    return await fetch(url, { ...init, signal: ctl?.signal });
  } catch (e) {
    throw arenaErro(e?.name === 'AbortError' ? 'A conexão demorou demais' : 'Sem conexão', 0, e?.name === 'AbortError' ? 'timeout' : 'sem_rede');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// SUPA é criado no DOMContentLoaded do auth.js, depois do handler de rotas do app.js.
function arenaSupaPronto(timeoutMs = 8000) {
  return new Promise(resolve => {
    const t0 = Date.now();
    (function esperar() {
      if (typeof SUPA !== 'undefined' && SUPA) return resolve(SUPA);
      if (Date.now() - t0 > timeoutMs) return resolve(null);
      setTimeout(esperar, 50);
    })();
  });
}

// Token do login. Se ele venceu e não dá para renová-lo por falta de rede, o erro é de rede (status 0,
// hint token_sem_rede), não 401: quem chama mantém a fila e só pede login quando houver rede.
async function arenaToken(renovar = false) {
  const supa = await arenaSupaPronto();
  if (!supa) throw arenaErro('Sem conexão', 0, 'token_sem_rede');
  let res;
  try {
    res = renovar ? await supa.auth.refreshSession() : await supa.auth.getSession();
  } catch (e) {
    res = { data: null, error: e };
  }
  const token = res?.data?.session?.access_token;
  if (token) return token;
  const erro = res?.error;
  const semRede = !navigator.onLine || (erro && (erro.name === 'AuthRetryableFetchError' || erro.status === 0 ||
    /fetch|network|load failed|timeout/i.test(erro.message || '')));
  if (semRede) throw arenaErro('Sem rede para renovar o login', 0, 'token_sem_rede');
  throw arenaErro('Entre de novo', 401, 'sem_sessao');
}

// Erro com .status (HTTP) e .hint (código estável do contrato). Falha de rede: status 0.
function arenaErro(msg, status, hint) {
  const e = new Error(msg);
  e.status = status;
  e.hint = hint || null;
  return e;
}

async function arenaRpc(nome, args = {}, opts = {}) {
  if (arenaDemoAtivo()) return arenaDemo.rpc(nome, args);
  const headers = { apikey: SUPA_KEY, 'Content-Type': 'application/json' };
  const chamar = () => arenaFetch(`${SUPA_URL}/rest/v1/rpc/${nome}`, { method: 'POST', headers, body: JSON.stringify(args) });
  if (opts.auth) headers.Authorization = 'Bearer ' + await arenaToken();
  let res = await chamar();
  if (opts.auth && res.status === 401) { // token vencido no servidor: renova uma vez e repete
    headers.Authorization = 'Bearer ' + await arenaToken(true);
    res = await chamar();
  }
  let body = null;
  try { body = await res.json(); } catch (e) { /* corpo vazio */ }
  if (!res.ok) throw arenaErro(body?.message || `Erro ${res.status}`, res.status, body?.hint);
  return body;
}

async function arenaFunction(nome, payload) {
  if (arenaDemoAtivo()) return arenaDemo.fn(nome, payload);
  const res = await arenaFetch(`/.netlify/functions/${nome}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  let body = null;
  try { body = await res.json(); } catch (e) { /* corpo vazio */ }
  if (!res.ok) throw arenaErro(body?.error || `Erro ${res.status}`, res.status);
  return body;
}

// Resposta fora de ordem: só aceita versão igual ou maior que a que já está na tela.
function arenaAceita(atual, nova, campo) {
  const va = atual?.championship?.[campo], vn = nova?.championship?.[campo];
  return va == null || vn == null || vn >= va;
}

function arenaUuid() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// Horários sempre no fuso da arena (America/Sao_Paulo), não no do aparelho.
function arenaHora(ms) {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: ARENA_FUSO });
}
function arenaDataHora(ts) {
  return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: ARENA_FUSO });
}
// Data de hoje (AAAA-MM-DD) e "data + HH:MM" em ms, no fuso da arena.
function arenaHoje(agora = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ARENA_FUSO }).format(new Date(agora));
}
// shortcut: Brasília sem horário de verão desde 2019 (-03:00 fixo); calcular o offset com Intl se ele voltar.
const arenaMs = (data, hhmm) => new Date(`${data}T${hhmm}:00-03:00`).getTime();

function arenaPlacar(p) {
  if (p.games_a == null || p.games_b == null) return '';
  const tb = p.tb_a != null || p.tb_b != null ? ` (${p.tb_a ?? 0}-${p.tb_b ?? 0})` : '';
  return `${p.games_a}x${p.games_b}${tb}`;
}

// Previsão de início das partidas pendentes de todas as categorias (fila global), pulando as pausas de hoje.
function arenaPrevisoes(pub, agora = Date.now()) {
  const regras = pub.championship?.regras || {};
  const hoje = arenaHoje(agora);
  const dia = (regras.dias || []).find(d => d.data === hoje);
  const ms = hhmm => arenaMs(hoje, hhmm);
  const quadras = (pub.quadras || []).filter(q => q.ativa !== false).length || 1;
  const prontas = (pub.partidas || []).filter(p => p.team_a && p.team_b);
  const inicio = Math.max(agora, dia ? ms(dia.inicio) : 0);
  const prev = BT8Championship.preverHorarios(prontas, {
    quadras, inicio, duracao_media_min: regras.duracao_media_min, intervalo_min: regras.intervalo_min,
    pausas: dia ? (dia.pausas || []).map(p => ({ inicio: ms(p.inicio), fim: ms(p.fim) })) : [],
  });
  const mapa = {};
  prev.forEach(x => (mapa[x.id] = x.previsto));
  return mapa;
}

// ══ MODO DEMO (?demo=1, fora de produção) ══════════════════
// Backend em memória que responde como as RPCs do contrato. No console: arenaDemo.ajustarPelaMesa(id, 4, 3).
const arenaDemo = (() => {
  let st = null;
  const C = () => BT8Championship;
  const NOMES = ['Ana Souza', 'Bia Lima', 'Cris Melo', 'Duda Reis', 'Eva Prado', 'Fê Costa', 'Gabi Rocha', 'Helô Dias',
    'Iara Nunes', 'Júlia Paz', 'Kel Moura', 'Lu Barros', 'Mari Teles', 'Nina Sá', 'Olga Vaz', 'Paty Leal',
    'Rafa Lins', 'Caio Brito', 'Tiago Melo', 'Davi Luz', 'Igor Paiva', 'Leo Matos', 'Rui Gomes', 'Teo Assis',
    'Sol Campos', 'Tati Farias', 'Vivi Lopes', 'Yas Cunha'];

  function montar() {
    const quadras = [1, 2, 3, 4].map(i => ({ id: 'q' + i, nome: 'Quadra ' + i, ordem: i, ativa: true }));
    const formato = { tam_grupo: 4, classificam: 2, preset_grupo: 'A', preset_mata: 'A' };
    const categorias = [
      { id: 'c1', nome: 'Feminino B', genero: 'F', max_duplas: 16, formato, ordem: 1, inscricoes_abertas: true },
      { id: 'c2', nome: 'Mista C', genero: 'X', max_duplas: 12, formato, ordem: 2, inscricoes_abertas: true },
    ];
    const duplas = [], grupos = [], partidas = [];
    let n = 0;
    [[categorias[0], 8], [categorias[1], 6]].forEach(([cat, qtd], ci) => {
      const ids = [];
      for (let i = 0; i < qtd; i++) {
        const a1 = NOMES[n++ % NOMES.length], a2 = NOMES[n++ % NOMES.length];
        const id = `${cat.id}-d${i + 1}`;
        ids.push({ id, seed: i < 2 ? i + 1 : null });
        duplas.push({ id, category_id: cat.id, nome: `${a1.split(' ')[0]} / ${a2.split(' ')[0]}`, atleta1: a1, atleta2: a2,
          status: 'confirmada', seed: i < 2 ? i + 1 : null, desistente: false });
      }
      const montagem = C().montarGrupos(ids, { semente: 11 + ci });
      const payload = C().payloadSorteio(montagem, C().gerarChave(montagem.grupos.map(g => g.nome)), { categoriaIndice: ci });
      montagem.grupos.forEach((g, i) => grupos.push({ id: `${cat.id}-g${g.nome}`, category_id: cat.id, nome: g.nome, ordem: i + 1,
        fechado: false, duplas: g.duplas, sorteio_desempate: null }));
      const uid = ref => `${cat.id}-${ref}`;
      const origem = o => (o && o.match_ref ? { match: uid(o.match_ref) } : o || null);
      payload.partidas.forEach(p => partidas.push({
        id: uid(p.ref), category_id: cat.id, fase: p.fase, group_id: p.grupo ? `${cat.id}-g${p.grupo}` : null,
        rodada: p.rodada, slot: p.slot, team_a: p.team_a || null, team_b: p.team_b || null,
        origem_a: origem(p.origem_a), origem_b: origem(p.origem_b),
        next_match_id: p.next_ref ? uid(p.next_ref) : null, next_slot: p.next_slot || null, prioridade: p.prioridade,
        court_id: null, status: 'agendada', games_a: null, games_b: null, tb_a: null, tb_b: null, vencedor: null,
        wo: false, desistencia: false, alerta_origem: false, scout_device: null,
        chamada_em: null, iniciada_em: null, encerrada_em: null, version: 1,
      }));
    });
    // Rodada 1 do Feminino B jogada; Q1 e Q2 em jogo, Q3 chamada, Q4 livre.
    const fila = partidas.filter(p => p.fase === 'grupo').sort((x, y) => x.prioridade - y.prioridade);
    const agora = Date.now();
    fila.slice(0, 4).forEach((p, i) => Object.assign(p, {
      status: 'encerrada', games_a: i % 2 ? 3 : 6, games_b: i % 2 ? 6 : 2 + i, tb_a: null, tb_b: null,
      encerrada_em: new Date(agora - (60 - i * 10) * 60000).toISOString(),
    }));
    fila.slice(0, 4).forEach(p => (p.vencedor = p.games_a > p.games_b ? p.team_a : p.team_b));
    Object.assign(fila[4], { status: 'em_jogo', court_id: 'q1', games_a: 3, games_b: 2, iniciada_em: new Date(agora - 20 * 60000).toISOString() });
    Object.assign(fila[5], { status: 'em_jogo', court_id: 'q2', games_a: 5, games_b: 5, iniciada_em: new Date(agora - 30 * 60000).toISOString() });
    Object.assign(fila[6], { status: 'chamada', court_id: 'q3', chamada_em: new Date(agora - 3 * 60000).toISOString() });
    const hoje = arenaHoje();
    st = {
      eventos: new Set(),
      arena: { nome: 'Arena Demo', cidade: 'Recife', estado: 'PE' },
      championship: {
        id: 'champ', titulo: 'Open de Verão (demo)', slug: 'demo', status: 'em_andamento',
        data_inicio: hoje, data_fim: hoje, inscricoes_ate: new Date(arenaMs(hoje, '23:59')).toISOString(), pausado: false, pausa_motivo: null,
        live_version: 1, estrutura_version: 1,
        regras: {
          dias: [{ data: hoje, inicio: '08:00', fim: '20:00', pausas: [{ inicio: '12:00', fim: '13:00' }] }],
          tolerancia_wo_min: 10, descanso_min: 15, duracao_media_min: 35, intervalo_min: 5,
          desistencia_modo: 'anular', wo_conta_saldo: true, cruzamento: 'melhores2', preset: 'A',
          regulamento: 'Regulamento de demonstração.\n1 set até 6 games, tie-break a 7 no 6x6.\nTolerância de WO: 10 minutos.',
        },
      },
      quadras, categorias, duplas, grupos, partidas,
    };
  }

  const estado = () => (st || montar(), st);
  const copia = o => JSON.parse(JSON.stringify(o));
  const nomeDupla = id => (st.duplas.find(d => d.id === id) || {}).nome || 'A definir';
  const versoes = () => ({ live_version: st.championship.live_version, estrutura_version: st.championship.estrutura_version });
  const mudouLive = () => st.championship.live_version++;
  const mudouEstrutura = () => { st.championship.live_version++; st.championship.estrutura_version++; };
  const partida = id => {
    const p = st.partidas.find(x => x.id === id);
    if (!p) throw arenaErro('Partida não encontrada', 400, 'nao_encontrado');
    return p;
  };
  const presetDe = p => {
    const f = (st.categorias.find(c => c.id === p.category_id) || {}).formato || {};
    return (p.fase === 'grupo' ? f.preset_grupo : f.preset_mata) || 'A';
  };
  const recusa = p => {
    if (['encerrada', 'wo', 'anulada'].includes(p.status)) return 'partida_encerrada';
    if (p.status === 'agendada' || p.status === 'suspensa') return 'partida_indisponivel';
    return null;
  };

  // Simula outros scouts: de vez em quando um game a mais numa quadra que ninguém assumiu neste aparelho.
  function animar() {
    const livres = st.partidas.filter(p => p.status === 'em_jogo' && !p.scout_device);
    if (!livres.length || Math.random() > 0.3) return;
    const p = livres[Math.floor(Math.random() * livres.length)];
    let e = BT8Scoring.dePlacarServidor(p, presetDe(p));
    e = BT8Scoring.marcar(e, Math.random() < 0.5 ? 'a' : 'b', 1, presetDe(p));
    if (BT8Scoring.fim(e, presetDe(p))) return; // o fim fica para a Mesa
    Object.assign(p, BT8Scoring.paraServidor(e, presetDe(p)));
    p.version++;
    mudouLive();
  }

  const rpcs = {
    arena_live({ p_since }) {
      animar();
      if (p_since === st.championship.live_version) return { ok: true, changed: false, ...versoes() };
      const grupo = id => (st.grupos.find(g => g.id === id) || {}).nome || null;
      return {
        ok: true, changed: true, server_time: new Date().toISOString(),
        championship: { ...copia(st.championship), regras: undefined },
        quadras: copia(st.quadras),
        partidas: st.partidas.filter(p => p.status === 'chamada' || p.status === 'em_jogo').map(p => ({
          id: p.id, court_id: p.court_id, status: p.status,
          categoria: (st.categorias.find(c => c.id === p.category_id) || {}).nome, fase: p.fase, grupo: grupo(p.group_id), rodada: p.rodada,
          team_a: { id: p.team_a, nome: nomeDupla(p.team_a) }, team_b: { id: p.team_b, nome: nomeDupla(p.team_b) },
          games_a: p.games_a, games_b: p.games_b, tb_a: p.tb_a, tb_b: p.tb_b,
          chamada_em: p.chamada_em, iniciada_em: p.iniciada_em, version: p.version,
        })),
      };
    },
    arena_public({ p_since_estrutura }) {
      if (p_since_estrutura === st.championship.estrutura_version) return { ok: true, changed: false, ...versoes() };
      return { ok: true, changed: true, arena: copia(st.arena), championship: copia(st.championship), quadras: copia(st.quadras),
        categorias: copia(st.categorias), duplas: copia(st.duplas), grupos: copia(st.grupos),
        partidas: st.partidas.map(p => { const c = copia(p); delete c.scout_device; delete c.version; return c; }) };
    },
    arena_inscricao_info() {
      return { ok: true, arena: { nome: st.arena.nome },
        championship: { titulo: st.championship.titulo, slug: 'demo', data_inicio: st.championship.data_inicio,
          data_fim: st.championship.data_fim, inscricoes_ate: st.championship.inscricoes_ate, status: 'inscricoes', aberto: true,
          pix: { chave: 'pix@arenademo.com.br', favorecido: 'Arena Demo', valor: 120 }, whatsapp: '+5581999990000' },
        categorias: st.categorias.map(c => {
          const inscritas = st.duplas.filter(d => d.category_id === c.id).length;
          return { id: c.id, nome: c.nome, genero: c.genero, max_duplas: c.max_duplas, inscritas,
            vagas: Math.max(0, c.max_duplas - inscritas), inscricoes_abertas: true };
        }) };
    },
    match_take({ p_match, p_device }) {
      const p = partida(p_match);
      if (!['agendada', 'chamada', 'em_jogo'].includes(p.status)) throw arenaErro('A partida não está em andamento', 400, 'status_invalido');
      p.scout_device = p_device;
      p.version++;
      mudouLive();
      return { ok: true, match: copia(p) };
    },
    match_score_push(a) {
      const p = partida(a.p_match);
      const motivo = recusa(p);
      if (motivo) return { ok: false, erro: motivo, match: copia(p) };
      if (p.scout_device !== a.p_device) return { ok: false, erro: 'outro_aparelho', match: copia(p) };
      if (st.eventos.has(a.p_client_event_id)) return { ok: true, duplicado: true, match: copia(p) };
      if (a.p_expected_version !== p.version) {
        return { ok: false, erro: 'conflito', version: p.version, por: p.ajustadoPelaMesa ? 'mesa' : 'scout',
          placar: { games_a: p.games_a, games_b: p.games_b, tb_a: p.tb_a, tb_b: p.tb_b }, match: copia(p) };
      }
      st.eventos.add(a.p_client_event_id);
      Object.assign(p, { games_a: a.p_games_a, games_b: a.p_games_b, tb_a: a.p_tb_a, tb_b: a.p_tb_b, ajustadoPelaMesa: false });
      if (p.status === 'chamada') Object.assign(p, { status: 'em_jogo', iniciada_em: new Date().toISOString() });
      p.version++;
      mudouLive();
      return { ok: true, match: copia(p) };
    },
    match_finish({ p_match, p_version, p_vencedor, p_device }) {
      const p = partida(p_match);
      const motivo = recusa(p);
      if (motivo) return { ok: false, erro: motivo, match: copia(p) };
      if (p_device && p.scout_device !== p_device) return { ok: false, erro: 'outro_aparelho', match: copia(p) };
      if (p_version !== p.version) {
        return { ok: false, erro: 'conflito', version: p.version, por: 'mesa',
          placar: { games_a: p.games_a, games_b: p.games_b, tb_a: p.tb_a, tb_b: p.tb_b }, match: copia(p) };
      }
      const v = BT8Championship.validarPlacar(p, presetDe(p));
      if (!v.ok || v.vencedor !== p_vencedor) throw arenaErro(v.erro || 'O vencedor não bate com o placar', 400, 'placar_invalido');
      Object.assign(p, { status: 'encerrada', vencedor: p['team_' + p_vencedor], encerrada_em: new Date().toISOString(), court_id: null });
      p.version++;
      if (p.next_match_id) {
        const nova = BT8Championship.avancar(st.partidas.filter(x => x.category_id === p.category_id), p.id);
        const prox = nova.find(x => x.id === p.next_match_id);
        Object.assign(partida(p.next_match_id), { team_a: prox.team_a, team_b: prox.team_b });
      }
      mudouEstrutura();
      return { ok: true, match: copia(p) };
    },
  };

  return {
    rpc(nome, args) {
      estado();
      if (!rpcs[nome]) return Promise.reject(arenaErro('RPC sem simulação: ' + nome, 404));
      return new Promise((resolve, reject) => setTimeout(() => {
        try { resolve(rpcs[nome](args || {})); } catch (e) { reject(e); }
      }, 150));
    },
    fn(nome, payload) {
      estado();
      if (nome !== 'arena-register') return Promise.reject(arenaErro('Function sem simulação: ' + nome, 404));
      const cat = st.categorias.find(c => c.id === payload.categoria_id);
      if (!cat) return Promise.reject(arenaErro('Escolha a categoria', 400));
      return Promise.resolve({ ok: true, team_id: arenaUuid(), status: 'pendente', pagamento: 'pendente', categoria: cat.nome,
        pix: { chave: 'pix@arenademo.com.br', favorecido: 'Arena Demo', valor: 120 }, whatsapp: '+5581999990000' });
    },
    // A Mesa corrige o placar: o próximo envio do scout recebe conflito com por = 'mesa'.
    ajustarPelaMesa(id, ga, gb) {
      const p = partida(id);
      Object.assign(p, { games_a: ga, games_b: gb, tb_a: null, tb_b: null, ajustadoPelaMesa: true });
      p.version++;
      mudouLive();
      return copia(p);
    },
    // Assume a partida por outro aparelho: o scout atual recebe "outro_aparelho".
    assumirPorOutro(id) {
      const p = partida(id);
      p.scout_device = 'outro-aparelho';
      p.version++;
      return copia(p);
    },
    get estado() { return estado(); },
  };
})();

// ══ PÁGINA PÚBLICA (/c/<slug>) ══════════════════════════════
const PB = { slug: '', live: null, pub: null, aba: 'vivo', cat: null, busca: '', timers: [], erro: null };

function openPublicoRoute(slug) {
  PB.slug = slug;
  PB.timers.forEach(clearInterval);
  const el = document.getElementById('screen-publico');
  el.innerHTML = `<div class="pb" id="pb">
    <header class="pb-top">
      <div class="pb-arena" id="pb-arena"></div>
      <h1 class="pb-titulo" id="pb-titulo">Carregando…</h1>
      <div class="pb-datas" id="pb-datas"></div>
    </header>
    <div class="pb-pausa" id="pb-pausa" hidden></div>
    <label class="pb-busca">
      <span class="pb-sr">Buscar meu nome</span>
      <input id="pb-busca" type="search" placeholder="Buscar meu nome" autocomplete="off" oninput="publicoBuscar(this.value)">
    </label>
    <div id="pb-resultado-busca"></div>
    <nav class="pb-tabs" role="tablist" id="pb-tabs"></nav>
    <div id="pb-cat"></div>
    <section id="pb-conteudo" class="pb-conteudo"></section>
    <footer class="pb-rodape">Feito com <a href="/">BT8</a></footer>
  </div>`;
  publicoAtualizar(true);
  PB.timers = [
    setInterval(() => { if (document.visibilityState === 'visible') publicoAtualizar(false); }, 15000),
  ];
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && PB.slug) publicoAtualizar(false);
  });
}

let publicoCiclo = 0;
async function publicoAtualizar(forcarEstrutura) {
  if (PB.ocupado) return; // uma atualização por vez
  PB.ocupado = true;
  try {
    const live = await arenaRpc('arena_live', { p_slug: PB.slug, p_since: PB.live?.championship?.live_version ?? null });
    if (live.ok === false) return publicoErro('Campeonato não encontrado.');
    if (live.changed !== false && arenaAceita(PB.live, live, 'live_version')) PB.live = live;
    // Estrutura a cada 30 s (2 ciclos de 15 s) ou assim que a versão dela muda.
    const ev = live.estrutura_version ?? live.championship?.estrutura_version;
    if (forcarEstrutura || !PB.pub || publicoCiclo++ % 2 === 1 || (ev != null && ev !== PB.pub.championship.estrutura_version)) {
      const pub = await arenaRpc('arena_public', { p_slug: PB.slug, p_since_estrutura: PB.pub?.championship?.estrutura_version ?? null });
      if (pub.ok === false) return publicoErro('Campeonato não encontrado.');
      if (pub.changed !== false && arenaAceita(PB.pub, pub, 'estrutura_version')) PB.pub = pub;
    }
    PB.erro = null;
    publicoRender();
  } catch (e) {
    PB.erro = e.status === 0 ? 'Sem conexão. Tentando de novo…' : e.message;
    if (!PB.pub) publicoErro(PB.erro);
  } finally {
    PB.ocupado = false;
  }
}

function publicoErro(msg) {
  const t = document.getElementById('pb-titulo');
  if (t) t.textContent = msg;
}

function publicoRender() {
  const pub = PB.pub, live = PB.live;
  if (!pub) return;
  const ch = pub.championship;
  document.title = `${ch.titulo} · BT8`;
  document.getElementById('pb-arena').textContent = [pub.arena?.nome, pub.arena?.cidade].filter(Boolean).join(' · ');
  document.getElementById('pb-titulo').textContent = ch.titulo;
  const data = d => (d ? d.split('-').reverse().slice(0, 2).join('/') : '');
  document.getElementById('pb-datas').textContent = ch.data_inicio === ch.data_fim ? data(ch.data_inicio) : `${data(ch.data_inicio)} a ${data(ch.data_fim)}`;
  const pausa = live?.championship?.pausado ? live.championship : ch.pausado ? ch : null;
  const faixa = document.getElementById('pb-pausa');
  faixa.hidden = !pausa;
  if (pausa) faixa.textContent = `PAUSA – ${pausa.pausa_motivo || 'evento pausado'}. As previsões estão congeladas.`;
  if (!PB.cat || !pub.categorias.some(c => c.id === PB.cat)) PB.cat = pub.categorias[0]?.id || null;
  const abas = [['vivo', 'Ao vivo'], ['grupos', 'Grupos'], ['mata', 'Mata-mata'], ['resultados', 'Resultados'], ['regulamento', 'Regulamento']];
  document.getElementById('pb-tabs').innerHTML = abas.map(([k, rotulo]) =>
    `<button role="tab" aria-selected="${PB.aba === k}" class="${PB.aba === k ? 'on' : ''}" onclick="publicoAba('${k}')">${rotulo}</button>`).join('');
  const comCategoria = PB.aba === 'grupos' || PB.aba === 'mata';
  document.getElementById('pb-cat').innerHTML = comCategoria && pub.categorias.length > 1
    ? `<div class="pb-cats">${pub.categorias.map(c => `<button class="${c.id === PB.cat ? 'on' : ''}" onclick="publicoCategoria('${escapeHtml(c.id)}')">${escapeHtml(c.nome)}</button>`).join('')}</div>`
    : '';
  const render = { vivo: publicoVivo, grupos: publicoGrupos, mata: publicoMata, resultados: publicoResultados, regulamento: publicoRegulamento }[PB.aba];
  document.getElementById('pb-conteudo').innerHTML = (PB.erro ? `<p class="pb-aviso">${escapeHtml(PB.erro)}</p>` : '') + render();
  publicoBuscar(PB.busca);
}

function publicoAba(k) { PB.aba = k; publicoRender(); }
function publicoCategoria(id) { PB.cat = id; publicoRender(); }

function publicoNomeQuadra(id) {
  return ((PB.pub?.quadras || []).find(q => q.id === id) || {}).nome || '';
}

function publicoVivo() {
  const quadras = (PB.live?.quadras || PB.pub.quadras || []).filter(q => q.ativa !== false).sort((x, y) => x.ordem - y.ordem);
  const partidas = PB.live?.partidas || [];
  const cards = quadras.map(q => {
    const p = partidas.find(x => x.court_id === q.id && x.status === 'em_jogo') || partidas.find(x => x.court_id === q.id);
    if (!p) return `<div class="pb-quadra"><div class="pb-quadra-nome">${escapeHtml(q.nome)}</div><div class="pb-livre">Livre</div></div>`;
    const tb = p.tb_a != null || p.tb_b != null ? `<div class="pb-tb">Tie-break ${p.tb_a ?? 0}-${p.tb_b ?? 0}</div>` : '';
    return `<div class="pb-quadra">
      <div class="pb-quadra-nome">${escapeHtml(q.nome)} <span class="pb-selo ${p.status === 'em_jogo' ? 'vivo' : 'chamada'}">${p.status === 'em_jogo' ? 'Ao vivo' : 'Chamada'}</span></div>
      <div class="pb-quadra-cat">${escapeHtml(p.categoria || '')}${p.grupo ? ' · Grupo ' + escapeHtml(p.grupo) : p.fase !== 'grupo' ? ' · ' + escapeHtml(BT8Championship.FASE_NOME[p.fase] || '') : ''}</div>
      <div class="pb-linha"><span>${escapeHtml(p.team_a?.nome)}</span><b>${p.games_a ?? 0}</b></div>
      <div class="pb-linha"><span>${escapeHtml(p.team_b?.nome)}</span><b>${p.games_b ?? 0}</b></div>${tb}
    </div>`;
  }).join('');
  const campeoes = PB.pub.categorias.map(c => ({ c, r: BT8Championship.resumoCategoria(PB.pub, c.id).campeoes })).filter(x => x.r);
  return publicoCampeoes(campeoes) + `<div class="pb-quadras">${cards || '<p class="pb-aviso">Nenhuma quadra cadastrada.</p>'}</div>`;
}

function publicoCampeoes(lista) {
  return lista.map(({ c, r }) => `<div class="pb-campeoes">
    <div class="pb-campeoes-cat">${escapeHtml(c.nome)}</div>
    <div>${icon('trophy')} Campeões: <b>${escapeHtml(r.campeao)}</b></div>
    <div>Vice: ${escapeHtml(r.vice)}</div>
    ${r.terceiros.length ? `<div>3º lugar: ${r.terceiros.map(escapeHtml).join(' e ')}</div>` : ''}
  </div>`).join('');
}

function publicoGrupos() {
  const r = BT8Championship.resumoCategoria(PB.pub, PB.cat);
  if (!r.grupos.length) return '<p class="pb-aviso">O sorteio dos grupos ainda não foi publicado.</p>';
  return r.grupos.map(g => `<div class="pb-grupo">
    <div class="pb-grupo-nome">Grupo ${escapeHtml(g.nome)}${g.fechado ? ' <span class="pb-fechado">fechado</span>' : ''}</div>
    <table class="pb-tabela">
      <thead><tr><th>#</th><th>Dupla</th><th title="Jogos">J</th><th title="Vitórias">V</th><th title="Saldo de games">SG</th><th title="Games pró">GP</th></tr></thead>
      <tbody>${g.tabela.map(l => `<tr class="${l.desistente ? 'desist' : ''}">
        <td>${l.pos}</td><td>${escapeHtml(l.nome || '')}<small>${escapeHtml(l.criterio === 'sorteio pendente' && !g.completo ? '' : l.criterio || '')}</small></td>
        <td>${l.jogos}</td><td>${l.vitorias}</td><td>${l.saldo > 0 ? '+' : ''}${l.saldo}</td><td>${l.gp}</td></tr>`).join('')}</tbody>
    </table>
    ${g.completo && g.pendenteSorteio.length ? '<p class="pb-nota">Empate a decidir por sorteio no fechamento do grupo.</p>' : ''}
  </div>`).join('') + '<p class="pb-nota">Desempate: vitórias; confronto direto (2 duplas) ou saldo entre as empatadas (3 ou mais); saldo no grupo; games pró; sorteio.</p>';
}

function publicoMata() {
  const r = BT8Championship.resumoCategoria(PB.pub, PB.cat);
  if (!r.mata.length) return '<p class="pb-aviso">O mata-mata ainda não foi publicado.</p>';
  let fase = null;
  const linhas = r.mata.map(p => {
    const titulo = p.fase !== fase ? `<div class="pb-fase">${escapeHtml(BT8Championship.FASE_NOME[p.fase])}</div>` : '';
    fase = p.fase;
    const venc = p.vencedor;
    return `${titulo}<div class="pb-jogo">
      <span class="${venc && venc === p.team_a ? 'venc' : ''}">${escapeHtml(p.nome_a)}</span>
      <b>${escapeHtml(arenaPlacar(p)) || 'x'}</b>
      <span class="${venc && venc === p.team_b ? 'venc' : ''}">${escapeHtml(p.nome_b)}</span>
    </div>`;
  }).join('');
  return publicoCampeoes(r.campeoes ? [{ c: r.categoria, r: r.campeoes }] : []) + linhas;
}

function publicoResultados() {
  const pub = PB.pub;
  const feitos = pub.partidas.filter(p => ['encerrada', 'wo'].includes(p.status))
    .sort((x, y) => String(y.encerrada_em || '').localeCompare(String(x.encerrada_em || '')));
  if (!feitos.length) return '<p class="pb-aviso">Nenhum resultado ainda.</p>';
  return feitos.map(p => publicoLinhaPartida(p)).join('');
}

function publicoLinhaPartida(p, previsoes) {
  const pub = PB.pub;
  const nome = id => (pub.duplas.find(d => d.id === id) || {}).nome || 'A definir';
  const cat = (pub.categorias.find(c => c.id === p.category_id) || {}).nome || '';
  const grupo = (pub.grupos.find(g => g.id === p.group_id) || {}).nome;
  const onde = grupo ? `Grupo ${grupo}` : BT8Championship.FASE_NOME[p.fase];
  const vivo = (PB.live?.partidas || []).find(x => x.id === p.id);
  let situacao;
  if (vivo) situacao = `${vivo.status === 'em_jogo' ? 'Ao vivo' : 'Chamada'} · ${escapeHtml(publicoNomeQuadra(vivo.court_id))} · ${arenaPlacar(vivo) || '0x0'}`;
  else if (p.status === 'wo') situacao = `WO · ${arenaPlacar(p)}`;
  else if (p.status === 'anulada') situacao = 'Anulada';
  else if (p.status === 'encerrada') situacao = arenaPlacar(p);
  else if (p.status === 'suspensa') situacao = 'Suspensa';
  else situacao = previsoes && previsoes[p.id] ? `Previsão ~${arenaHora(previsoes[p.id])}` : 'Aguardando';
  const venc = p.vencedor;
  return `<div class="pb-jogo pb-jogo-det">
    <div class="pb-jogo-meta">${escapeHtml(cat)} · ${escapeHtml(onde || '')}</div>
    <div class="pb-jogo-duplas"><span class="${venc && venc === p.team_a ? 'venc' : ''}">${escapeHtml(nome(p.team_a))}</span> x
      <span class="${venc && venc === p.team_b ? 'venc' : ''}">${escapeHtml(nome(p.team_b))}</span></div>
    <div class="pb-jogo-sit">${situacao}</div>
  </div>`;
}

function publicoRegulamento() {
  const r = PB.pub.championship.regras || {};
  const itens = [
    `Jogo: 1 set até ${r.preset === 'B' ? '4 games, tie-break a 7 no 4x4' : '6 games, tie-break a 7 no 6x6'}.`,
    'Desempate no grupo: vitórias; confronto direto entre 2 duplas; entre 3 ou mais, saldo de games entre as empatadas, saldo no grupo, games pró e sorteio.',
    `Tolerância de WO: ${r.tolerancia_wo_min ?? 10} minutos. WO ${r.wo_conta_saldo === false ? 'não conta no saldo' : 'conta 6x0 no saldo'}.`,
    `Desistência: ${r.desistencia_modo === 'manter_wo' ? 'mantém os jogos feitos e WO no restante' : 'anula todos os jogos da dupla'}.`,
    'Fechar o grupo encerra o prazo de protesto.',
  ];
  return `<ul class="pb-regras">${itens.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
    ${r.regulamento ? `<div class="pb-regulamento">${escapeHtml(r.regulamento)}</div>` : ''}`;
}

function publicoBuscar(valor) {
  PB.busca = valor || '';
  const alvo = document.getElementById('pb-resultado-busca');
  if (!alvo || !PB.pub) return;
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = norm(PB.busca.trim());
  if (q.length < 3) { alvo.innerHTML = ''; return; }
  const duplas = PB.pub.duplas.filter(d => norm(`${d.nome} ${d.atleta1} ${d.atleta2}`).includes(q));
  if (!duplas.length) { alvo.innerHTML = '<p class="pb-aviso">Nenhuma dupla com esse nome.</p>'; return; }
  const previsoes = arenaPrevisoes(PB.pub);
  const prioridade = p => (['encerrada', 'wo', 'anulada'].includes(p.status) ? 1 : 0);
  alvo.innerHTML = duplas.slice(0, 5).map(d => {
    const jogos = PB.pub.partidas.filter(p => p.team_a === d.id || p.team_b === d.id)
      .sort((x, y) => prioridade(x) - prioridade(y) || (x.prioridade || 0) - (y.prioridade || 0));
    const cat = (PB.pub.categorias.find(c => c.id === d.category_id) || {}).nome || '';
    return `<div class="pb-minha">
      <div class="pb-minha-nome">${escapeHtml(d.nome)} <small>${escapeHtml(cat)}</small></div>
      ${jogos.map(p => publicoLinhaPartida(p, previsoes)).join('') || '<p class="pb-nota">Sem jogos ainda.</p>'}
    </div>`;
  }).join('');
}

// ══ INSCRIÇÃO (/inscricao/<token>) ═════════════════════════
const INSC = { token: '', info: null, enviando: false };

async function openInscricaoRoute(token) {
  INSC.token = token;
  const el = document.getElementById('screen-inscricao');
  el.innerHTML = '<div class="pb pb-insc"><p class="pb-aviso">Carregando…</p></div>';
  try {
    const info = await arenaRpc('arena_inscricao_info', { p_token: token });
    if (info.ok === false) throw arenaErro('Link de inscrição inválido ou trocado pela arena.', 404);
    INSC.info = info;
    inscricaoForm();
  } catch (e) {
    el.innerHTML = `<div class="pb pb-insc"><p class="pb-aviso">${escapeHtml(e.status === 0 ? 'Sem conexão. Recarregue a página.' : e.message)}</p></div>`;
  }
}

function inscricaoForm() {
  const { arena, championship: ch, categorias } = INSC.info;
  const el = document.getElementById('screen-inscricao');
  document.title = `Inscrição · ${ch.titulo}`;
  if (!ch.aberto) {
    el.innerHTML = `<div class="pb pb-insc"><header class="pb-top"><div class="pb-arena">${escapeHtml(arena.nome)}</div>
      <h1 class="pb-titulo">${escapeHtml(ch.titulo)}</h1></header><p class="pb-aviso">As inscrições estão fechadas.</p></div>`;
    return;
  }
  const termo = inscricaoTermoLgpd(arena.nome);
  if (!termo) {
    el.innerHTML = `<div class="pb pb-insc"><header class="pb-top"><div class="pb-arena">${escapeHtml(arena.nome)}</div>
      <h1 class="pb-titulo">${escapeHtml(ch.titulo)}</h1></header>
      <p class="pb-aviso">As inscrições por este link ainda não estão disponíveis. Fale com a arena.</p></div>`;
    return;
  }
  const lgpd = termo.html;
  const opcoes = categorias.filter(c => c.inscricoes_abertas !== false).map(c =>
    `<option value="${escapeHtml(c.id)}">${escapeHtml(c.nome)} — ${c.vagas > 0 ? `${c.vagas} vaga${c.vagas === 1 ? '' : 's'}` : 'lotada (lista de espera)'}</option>`).join('');
  const atleta = (n, rotulo) => `<fieldset class="pb-atleta"><legend>${rotulo}</legend>
    <label>Nome completo<input name="nome${n}" required minlength="3" maxlength="80" autocomplete="${n === 1 ? 'name' : 'off'}"></label>
    <label>WhatsApp com DDD<input name="tel${n}" required inputmode="tel" maxlength="20" placeholder="(81) 99999-0000" autocomplete="${n === 1 ? 'tel' : 'off'}"></label>
  </fieldset>`;
  el.innerHTML = `<div class="pb pb-insc">
    <header class="pb-top"><div class="pb-arena">${escapeHtml(arena.nome)}</div><h1 class="pb-titulo">${escapeHtml(ch.titulo)}</h1>
      ${ch.inscricoes_ate ? `<div class="pb-datas">Inscrições até ${escapeHtml(arenaDataHora(ch.inscricoes_ate))}</div>` : ''}</header>
    <form id="insc-form" class="pb-form" onsubmit="inscricaoEnviar(event)" novalidate>
      <label>Categoria<select name="categoria" required><option value="">Escolha</option>${opcoes}</select></label>
      ${atleta(1, 'Você')}${atleta(2, 'Seu parceiro ou parceira')}
      <div class="pb-hp" aria-hidden="true"><label>Site<input name="website" tabindex="-1" autocomplete="off"></label></div>
      <div class="pb-lgpd">${lgpd}</div>
      <label class="pb-check"><input type="checkbox" name="lgpd" required> Li e aceito o uso dos dados acima.</label>
      <p class="pb-erro" id="insc-erro" role="alert"></p>
      <button class="pb-btn" type="submit" id="insc-btn">Inscrever dupla</button>
    </form>
  </div>`;
}

// Texto e versão da LGPD vêm do legal-pages.js (arenaLgpdHtml, BT8_ARENA_LGPD_VERSAO). Sem eles não há
// inscrição pelo link: a versão aceita precisa ser exatamente a que o backend confere. No demo, texto local.
function inscricaoTermoLgpd(nomeArena) {
  if (typeof arenaLgpdHtml === 'function' && typeof BT8_ARENA_LGPD_VERSAO !== 'undefined') {
    return { html: arenaLgpdHtml(nomeArena), versao: BT8_ARENA_LGPD_VERSAO };
  }
  if (arenaDemoAtivo()) {
    return { versao: 'demo', html: `<p>(Demonstração) Seus dados são usados por ${escapeHtml(nomeArena)} só para organizar este campeonato.</p>` };
  }
  return null;
}

async function inscricaoEnviar(ev) {
  ev.preventDefault();
  if (INSC.enviando) return;
  const f = ev.target;
  const erro = document.getElementById('insc-erro');
  const v = n => f.elements[n].value.trim();
  const digitos = s => s.replace(/\D/g, '');
  let msg = '';
  if (!v('categoria')) msg = 'Escolha a categoria.';
  else if (v('nome1').length < 3 || v('nome2').length < 3) msg = 'Informe o nome completo dos dois atletas.';
  else if (![v('tel1'), v('tel2')].every(t => digitos(t).length >= 10 && digitos(t).length <= 13)) msg = 'Informe o WhatsApp dos dois com DDD.';
  else if (!f.elements.lgpd.checked) msg = 'É preciso aceitar o uso dos dados para se inscrever.';
  erro.textContent = msg;
  if (msg) return;
  INSC.enviando = true;
  const btn = document.getElementById('insc-btn');
  btn.disabled = true;
  btn.textContent = 'Enviando…';
  try {
    const r = await arenaFunction('arena-register', {
      token: INSC.token, categoria_id: v('categoria'),
      atleta1: { nome: v('nome1'), telefone: v('tel1') }, atleta2: { nome: v('nome2'), telefone: v('tel2') },
      lgpd: true, lgpd_versao: inscricaoTermoLgpd(INSC.info.arena.nome).versao,
      website: f.elements.website.value,
    });
    inscricaoConfirmacao(r, `${v('nome1')} / ${v('nome2')}`);
  } catch (e) {
    erro.textContent = e.status === 429 ? 'Muitas tentativas. Espere alguns minutos e tente de novo.' : e.message;
    btn.disabled = false;
    btn.textContent = 'Inscrever dupla';
  } finally {
    INSC.enviando = false;
  }
}

function inscricaoConfirmacao(r, dupla) {
  const { arena, championship: ch } = INSC.info;
  const situacao = {
    confirmada: 'Inscrição confirmada',
    pendente: 'Inscrição recebida: falta o pagamento.',
    espera: 'A categoria lotou: vocês estão na lista de espera.',
  }[r.status] || 'Inscrição recebida.';
  const pix = r.status === 'pendente' && r.pix ? r.pix : null;
  const zap = String(r.whatsapp || ch.whatsapp || '').replace(/\D/g, '');
  const texto = encodeURIComponent(`Olá! Segue o comprovante da inscrição de ${dupla} (${r.categoria}) no ${ch.titulo}.`);
  document.getElementById('screen-inscricao').innerHTML = `<div class="pb pb-insc">
    <header class="pb-top"><div class="pb-arena">${escapeHtml(arena.nome)}</div><h1 class="pb-titulo">${escapeHtml(ch.titulo)}</h1></header>
    <div class="pb-ok">
      <div class="pb-ok-titulo">${escapeHtml(situacao)}</div>
      <div>${escapeHtml(dupla)} · ${escapeHtml(r.categoria || '')}</div>
      ${pix ? `<div class="pb-pix">
        <div>Pix${pix.valor ? ` de R$ ${Number(pix.valor).toFixed(2).replace('.', ',')}` : ''} para ${escapeHtml(pix.favorecido || arena.nome)}</div>
        <code id="insc-pix">${escapeHtml(pix.chave)}</code>
        <button class="pb-btn pb-btn-sec" type="button" onclick="inscricaoCopiarPix()">Copiar chave Pix</button>
      </div>` : ''}
      ${zap && r.status === 'pendente' ? `<a class="pb-btn" href="https://wa.me/${zap}?text=${texto}" target="_blank" rel="noopener">Enviar comprovante</a>` : ''}
      ${ch.slug ? `<a class="pb-link" href="/c/${encodeURIComponent(ch.slug)}">Ver a página do campeonato</a>` : ''}
    </div>
  </div>`;
}

function inscricaoCopiarPix() {
  const chave = document.getElementById('insc-pix')?.textContent || '';
  const rotulo = txt => { const b = document.querySelector('.pb-pix .pb-btn'); if (b) b.textContent = txt; };
  const falhou = () => rotulo('Não deu para copiar: selecione a chave acima');
  // "Chave copiada" só quando a área de transferência confirmou.
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(chave).then(() => rotulo('Chave copiada'), falhou);
  else falhou();
}
