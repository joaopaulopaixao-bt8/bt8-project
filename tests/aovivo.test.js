// Scout, API da arena e fuso: carrega config.js, o motor, publico.js e scout.js num contexto isolado
// do Node (DOM mínimo de mentira) e exercita a fila offline contra o backend demo em memória.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function carregar({ hostname = 'localhost', search = '?demo=1', appEnv = 'production', onLine = true } = {}) {
  const els = new Map();
  const el = id => {
    if (!els.has(id)) els.set(id, { id, innerHTML: '', textContent: '', className: '', hidden: false, elements: {},
      classList: { toggle() {}, add() {}, remove() {} } });
    return els.get(id);
  };
  const store = new Map();
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval, URLSearchParams, AbortController, Intl,
    crypto: require('crypto').webcrypto,
    alert: () => {},
    fetch: () => Promise.reject(new Error('sem fetch no teste')),
    location: { hostname, search, pathname: '/scout', reload() {} },
    navigator: { onLine },
    document: { getElementById: el, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, visibilityState: 'visible', documentElement: {} },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    BT8_ENV: { APP_ENV: appEnv },
    SUPA: null, SUPA_URL: 'https://api.teste', SUPA_KEY: 'chave-publica',
  });
  ctx.window = ctx;
  for (const f of ['src/js/config.js', 'src/js/championship.js', 'src/js/scoring.js', 'src/js/publico.js', 'src/js/scout.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  }
  const get = expr => vm.runInContext(expr, ctx);
  return { ctx, get, els, store };
}

const espera = ms => new Promise(ok => setTimeout(ok, ms));

// Abre a quadra 1 do demo no scout (SC.ctx como depois do login).
async function abrirScout(app, quadra = 'q1') {
  const { ctx, get } = app;
  const demo = get('arenaDemo');
  const SC = get('SC');
  // sem simular outros scouts mexendo no placar durante o teste (o demo só anima partidas sem aparelho)
  demo.estado.partidas.forEach(p => { if (p.status === 'em_jogo') p.scout_device = 'parado'; });
  SC.ctx = { slug: 'demo', titulo: 'Demo', categorias: demo.estado.categorias };
  SC.live = await ctx.arenaRpc('arena_live', { p_slug: 'demo' });
  const resumo = SC.live.partidas.find(p => p.court_id === quadra);
  await ctx.scoutAssumir(resumo.id);
  return { demo, SC, id: resumo.id, servidor: () => demo.estado.partidas.find(p => p.id === resumo.id) };
}

async function esvaziar(app) {
  const SC = app.get('SC');
  for (let i = 0; i < 60; i++) {
    if (!SC.enviando && !app.ctx.scoutProximoPendente()) return;
    await espera(50);
  }
}

const placar = p => [p.games_a, p.games_b, p.tb_a ?? null, p.tb_b ?? null];

test('demo só em host local ou build fora de produção (nunca no netlify.app de produção)', () => {
  assert.equal(carregar().ctx.arenaDemoAtivo(), true);
  assert.equal(carregar({ hostname: 'bt8-prod.netlify.app' }).ctx.arenaDemoAtivo(), false);
  assert.equal(carregar({ hostname: 'bt8.com.br' }).ctx.arenaDemoAtivo(), false);
  assert.equal(carregar({ hostname: 'arena--bt8.netlify.app', appEnv: 'branch-deploy' }).ctx.arenaDemoAtivo(), true);
  assert.equal(carregar({ hostname: 'bt8.test' }).ctx.arenaDemoAtivo(), true);
  assert.equal(carregar({ search: '' }).ctx.arenaDemoAtivo(), false);
});

test('fetch com timeout vira "sem rede" (status 0) e libera quem espera', async () => {
  const { ctx } = carregar();
  ctx.fetch = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))));
  const t0 = Date.now();
  await assert.rejects(ctx.arenaFetch('https://x', {}, 60), e => e.status === 0 && e.hint === 'timeout');
  assert.ok(Date.now() - t0 < 1000);
});

test('login vencido sem rede é erro de rede; com rede e sessão inválida é 401', async () => {
  const app = carregar();
  app.ctx.SUPA = { auth: { getSession: async () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch' } }) } };
  await assert.rejects(app.ctx.arenaToken(), e => e.status === 0 && e.hint === 'token_sem_rede');
  app.ctx.SUPA = { auth: { getSession: async () => ({ data: { session: null }, error: { name: 'AuthApiError', message: 'Invalid Refresh Token' } }) } };
  await assert.rejects(app.ctx.arenaToken(), e => e.status === 401);
  app.ctx.SUPA = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } };
  assert.equal(await app.ctx.arenaToken(), 'tok');
});

test('resposta perdida: conflito "por scout" mantém o placar local, adota a versão e reenvia', async () => {
  const app = carregar();
  const { demo, SC, id, servidor } = await abrirScout(app);
  app.ctx.scoutTocar('a', 1);
  await esvaziar(app);
  // O próximo toque é gravado no servidor, mas a resposta se perde (o aparelho não fica sabendo).
  app.ctx.scoutTocar('a', 1);
  const pend = app.ctx.scoutPendente(id);
  await demo.rpc('match_score_push', { p_match: id, p_expected_version: pend.versao, p_client_event_id: 'perdido', p_device: SC.device,
    p_games_a: pend.placar.games_a, p_games_b: pend.placar.games_b, p_tb_a: null, p_tb_b: null });
  await esvaziar(app);
  app.ctx.scoutTocar('b', 1); // vai com a versão velha → conflito por scout
  await esvaziar(app);
  // Quadra 1 do demo começa em 3x2: +a (4x2), +a perdido (5x2), +b → 5x3 no aparelho E no servidor.
  assert.deepEqual(placar(SC.estado), [5, 3, null, null]);
  assert.deepEqual(placar(servidor()), [5, 3, null, null]);
  assert.equal(SC.aviso, null);
  assert.equal(app.ctx.scoutPendente(id), null);
  assert.equal(SC.version, servidor().version);
});

test('conflito da Mesa: o servidor manda, o pendente é descartado e o scout vê o aviso', async () => {
  const app = carregar();
  const { demo, SC, id, servidor } = await abrirScout(app);
  demo.ajustarPelaMesa(id, 4, 3);
  app.ctx.scoutTocar('a', 1);
  await esvaziar(app);
  assert.deepEqual(placar(SC.estado), [4, 3, null, null]);
  assert.deepEqual(placar(servidor()), [4, 3, null, null]);
  assert.match(SC.aviso, /Placar ajustado pela Mesa: 4x3/);
  assert.equal(app.ctx.scoutPendente(id), null);
});

test('pendentes de outras partidas também são enviados; o de partida encerrada é descartado', async () => {
  const app = carregar();
  const { demo, SC } = await abrirScout(app);
  const q2 = demo.estado.partidas.find(p => p.court_id === 'q2');
  q2.scout_device = SC.device;
  const encerrada = demo.estado.partidas.find(p => p.status === 'encerrada');
  const fila = app.ctx.scoutFila();
  fila[q2.id] = { placar: { games_a: 6, games_b: 5, tb_a: null, tb_b: null }, client_event_id: 'x1', em: 1, versao: q2.version };
  fila[encerrada.id] = { placar: { games_a: 1, games_b: 1, tb_a: null, tb_b: null }, client_event_id: 'x2', em: 1, versao: 1 };
  await app.ctx.scoutEnviar();
  await esvaziar(app);
  assert.deepEqual(placar(q2), [6, 5, null, null]);
  assert.deepEqual(Object.keys(app.ctx.scoutFila()), []);
  assert.notDeepEqual(placar(encerrada), [1, 1, null, null]);
});

test('assumir de novo começa pelo servidor e só oferece o pendente se o servidor não avançou', async () => {
  const app = carregar();
  const { demo, SC, id, servidor } = await abrirScout(app);
  const base = servidor();
  // pendente antigo deste aparelho, gravado quando o servidor estava na versão atual
  app.ctx.scoutFila()[id] = { placar: { games_a: 5, games_b: 2, tb_a: null, tb_b: null }, client_event_id: 'velho', em: 1, versao: base.version };
  await app.ctx.scoutAssumir(id);
  assert.deepEqual(placar(SC.estado), placar(base));
  assert.deepEqual(placar(SC.oferta), [5, 2, null, null]);
  await app.ctx.scoutEnviar(); // pendente em espera de decisão não é enviado
  assert.notDeepEqual(placar(servidor()), [5, 2, null, null]);
  app.ctx.scoutUsarPendente();
  await esvaziar(app);
  assert.deepEqual(placar(servidor()), [5, 2, null, null]);
  // servidor avançou desde o pendente: descarta e avisa, sem oferecer
  app.ctx.scoutFila()[id] = { placar: { games_a: 0, games_b: 4, tb_a: null, tb_b: null }, client_event_id: 'velho2', em: 1, versao: servidor().version - 3 };
  await app.ctx.scoutAssumir(id);
  assert.equal(SC.oferta, null);
  assert.equal(app.ctx.scoutPendente(id), null);
  assert.match(SC.aviso, /0x4 não enviado daqui foi descartado/);
  assert.equal(demo.estado.partidas.length > 0, true);
});

test('encerrar: conflito no envio pede nova confirmação; toque duplo chama match_finish uma vez', async () => {
  const app = carregar();
  const { demo, SC, id, servidor } = await abrirScout(app);
  // leva a 5x4 e marca 6x4 (fim)
  demo.ajustarPelaMesa(id, 5, 4);
  SC.version = servidor().version;
  SC.estado = { games_a: 5, games_b: 4, tb_a: null, tb_b: null };
  app.ctx.scoutTocar('a', 1);
  demo.ajustarPelaMesa(id, 5, 5); // a Mesa mexe antes do envio chegar
  await app.ctx.scoutEncerrar();
  assert.equal(servidor().status, 'em_jogo');
  assert.deepEqual(placar(SC.estado), [5, 5, null, null]);
  assert.ok(SC.aviso);
  // agora 7x5 e dois toques no "Confirmar"
  app.ctx.scoutTocar('a', 1); app.ctx.scoutTocar('a', 1);
  let finais = 0;
  const rpc = demo.rpc;
  demo.rpc = (nome, args) => { if (nome === 'match_finish') finais++; return rpc(nome, args); };
  await Promise.all([app.ctx.scoutEncerrar(), app.ctx.scoutEncerrar()]);
  assert.equal(finais, 1);
  assert.equal(servidor().status, 'encerrada');
  assert.equal(SC.view, 'mensagem');
});

test('encerrar com a resposta do sucesso perdida: partida já encerrada com o mesmo placar é sucesso', async () => {
  const app = carregar();
  const { demo, SC, id, servidor } = await abrirScout(app);
  demo.ajustarPelaMesa(id, 6, 3);
  SC.version = servidor().version;
  SC.estado = { games_a: 6, games_b: 3, tb_a: null, tb_b: null };
  await demo.rpc('match_finish', { p_match: id, p_version: servidor().version, p_vencedor: 'a', p_device: SC.device });
  await app.ctx.scoutEncerrar();
  assert.equal(SC.view, 'mensagem');
  assert.match(app.els.get('screen-scout').innerHTML, /Partida encerrada/);
});

test('login vencido sem rede: fica no jogo, guarda os toques e avisa para entrar quando a rede voltar', async () => {
  const app = carregar();
  const { SC, id } = await abrirScout(app);
  const original = app.ctx.arenaRpc;
  app.ctx.arenaRpc = async () => { throw app.ctx.arenaErro('Sem rede para renovar o login', 0, 'token_sem_rede'); };
  app.ctx.scoutTocar('a', 1);
  app.ctx.scoutTocar('b', 1);
  await esvaziar(app);
  await espera(50);
  assert.equal(SC.view, 'jogo');
  assert.ok(app.ctx.scoutPendente(id));
  app.ctx.scoutTick();
  assert.match(app.els.get('sc-rede').textContent, /entre de novo quando a rede voltar/);
  app.ctx.arenaRpc = original;
  await app.ctx.scoutEnviar();
  await esvaziar(app);
  assert.equal(app.ctx.scoutPendente(id), null);
});

test('horários no fuso de São Paulo e respostas fora de ordem ignoradas', () => {
  const { ctx, get } = carregar();
  ctx.arenaMs = get('arenaMs');
  const noite = Date.UTC(2026, 11, 12, 1, 30); // 22:30 de 11/12 em Brasília
  assert.equal(ctx.arenaHoje(noite), '2026-12-11');
  assert.equal(ctx.arenaHora(noite), '22:30');
  assert.equal(ctx.arenaDataHora('2026-12-09T02:59:00Z'), '08/12/2026, 23:59');
  assert.equal(ctx.arenaMs('2026-12-11', '08:00'), Date.UTC(2026, 11, 11, 11, 0));
  assert.equal(ctx.arenaAceita({ championship: { live_version: 9 } }, { championship: { live_version: 8 } }, 'live_version'), false);
  assert.equal(ctx.arenaAceita({ championship: { live_version: 9 } }, { championship: { live_version: 10 } }, 'live_version'), true);
  assert.equal(ctx.arenaAceita(null, { championship: { live_version: 1 } }, 'live_version'), true);
});
