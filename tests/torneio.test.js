const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./engine');

const names = n => Array.from({ length: n }, (_, i) => 'P' + (i + 1));

// Super 4 com "+ Final"; a Dupla A vence todas as rodadas por 6 x 2.
function s4ComFinal(opts) {
  const eng = loadEngine(opts);
  Object.assign(eng.ctx.APP, { mode: 's4', category: 'individual', fmt: 'final', players: names(4).map(name => ({ name })) });
  eng.get('buildMatches()');
  return eng;
}
const rounds = ctx => ctx.APP.matches.filter(m => m.phase === 'round');
const finalOf = ctx => ctx.APP.matches.find(m => m.phase === 'final');
function jogarRodadas(ctx) { for (const m of rounds(ctx)) { m.sA = 6; m.sB = 2; } }

test('validateScore: aceita inteiros de 0 a 99 sem empate', () => {
  const { get } = loadEngine();
  assert.deepEqual({ ...get("validateScore('6', '4')") }, { sA: 6, sB: 4 });
  assert.deepEqual({ ...get("validateScore(' 0 ', '99')") }, { sA: 0, sB: 99 });
});

test('validateScore: recusa vazio, decimal, negativo, acima do teto e empate', () => {
  const { get } = loadEngine();
  assert.ok(get("validateScore('', '4')").incomplete);
  for (const [a, b] of [['1.5', '3'], ['-1', '3'], ['1e2', '3'], ['abc', '3'], ['100', '3'], ['5', '5']]) {
    assert.ok(get(`validateScore('${a}', '${b}')`).error, `${a} x ${b} deveria ser recusado`);
  }
});

test('+ Final: finalistas só aparecem com as rodadas concluídas', () => {
  const { ctx, get } = s4ComFinal();
  get('setFinalists(APP.matches.find(m => m.phase === "final"))');
  assert.equal(finalOf(ctx).teamA, '');
  jogarRodadas(ctx);
  get('setFinalists(APP.matches.find(m => m.phase === "final"))');
  const top2 = Array.from(get('rankRounds()'), p => p.name).slice(0, 2);
  assert.deepEqual([finalOf(ctx).teamA, finalOf(ctx).teamB], top2);
});

test('+ Final: campeão da final é o 1º do ranking e finalistas ficam congelados', () => {
  const { ctx, get } = s4ComFinal();
  jogarRodadas(ctx);
  const fn = finalOf(ctx);
  get('setFinalists(APP.matches.find(m => m.phase === "final"))');
  const [a, b] = [fn.teamA, fn.teamB];
  fn.sA = 2; fn.sB = 6; // o 2º das rodadas vence a final
  const stand = Array.from(get('getStandings()'), p => p.name);
  assert.deepEqual(stand.slice(0, 2), [b, a]);
  assert.equal(stand.length, 4);

  // Correção de rodada depois da final não troca quem jogou a final.
  for (const m of rounds(ctx)) { m.sA = 0; m.sB = 6; }
  get('setFinalists(APP.matches.find(m => m.phase === "final"))');
  assert.deepEqual([fn.teamA, fn.teamB], [a, b]);
  assert.equal(get('getStandings()')[0].name, b);
});

test('torneio ativo: serializa e restaura sem perder placar', () => {
  const { ctx, get } = s4ComFinal();
  rounds(ctx)[0].sA = 6; rounds(ctx)[0].sB = 3;
  ctx.APP.history = ['screen-home']; ctx.APP.isGuest = true;
  get('saveActiveTournament()');
  const data = get('readActiveTournament()');
  assert.ok(data.state.tourneyUid);
  assert.equal(data.state.history, undefined);
  assert.equal(data.state.isGuest, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(data.state.matches)), JSON.parse(JSON.stringify(ctx.APP.matches)));
});

test('torneio ativo: terminado e não salvo nunca expira; em andamento expira em 7 dias', () => {
  const { ctx, get, store } = s4ComFinal();
  const age = () => {
    const d = JSON.parse(store.get('bt8_active_tournament'));
    d.savedAt -= 8 * 24 * 60 * 60 * 1000;
    store.set('bt8_active_tournament', JSON.stringify(d));
  };
  get('saveActiveTournament()'); age();
  assert.equal(get('readActiveTournament()'), null);

  jogarRodadas(ctx);
  const fn = finalOf(ctx); fn.teamA = 'P1'; fn.teamB = 'P2'; fn.sA = 6; fn.sB = 1;
  ctx.APP._pendingSave = true;
  get('saveActiveTournament()'); age();
  assert.ok(get('readActiveTournament()'));
});

// Supabase falso: registra inserts/updates em `calls`.
function fakeSupa(calls, { failInsert = false, noClientUid = false, limitError = false, updateRows = [{ id: 't1' }] } = {}) {
  const chain = result => {
    const p = Promise.resolve(result);
    const c = { select: () => c, eq: () => c, order: () => c, limit: () => c, single: () => p, then: (...a) => p.then(...a) };
    return c;
  };
  return {
    from: () => ({
      insert: row => { calls.push(['insert', row]); return chain(failInsert ? { error: { code: '500', message: 'falhou' } } : { data: { id: 't1' } }); },
      upsert: (row, opts) => {
        calls.push(['upsert', row, opts]);
        if (noClientUid) return chain({ error: { code: 'PGRST204', message: "Could not find the 'client_uid' column" } });
        if (limitError) return chain({ error: { code: 'P0001', hint: 'free_limit_reached', message: 'Limite do plano Free atingido' } });
        return chain(failInsert ? { error: { code: '500', message: 'falhou' } } : { data: { id: 't1' } });
      },
      update: row => { calls.push(['update', row]); return chain({ data: updateRows }); },
      select: () => chain({ data: [] }),
    }),
  };
}

function torneioTerminado() {
  const eng = s4ComFinal({ withHistory: true });
  const { ctx, get } = eng;
  Object.assign(ctx, {
    validateFreeSaveLimit: async () => ({ allowed: true }),
    trackEvent: () => {}, currentAccess: () => ({}), showFreeLimitReached: () => {},
  });
  jogarRodadas(ctx);
  get('setFinalists(APP.matches.find(m => m.phase === "final"))');
  const fn = finalOf(ctx); fn.sA = 6; fn.sB = 4;
  ctx.APP._pendingSave = true;
  return eng;
}

test('visitante termina o torneio: fica pendente no aparelho e salva depois do login', async () => {
  const { ctx, get } = torneioTerminado();
  assert.equal(await get('saveTournament()'), false);
  assert.equal(get('PENDING_SAVE_REASON'), 'guest');
  assert.ok(get('pendingTournament()'));

  const calls = [];
  ctx.SUPA = fakeSupa(calls); ctx.SUPA_USER = { id: 'u1' };
  get('APP.matches = []'); // app reaberto: o torneio só existe no aparelho
  assert.equal(await get('savePendingTournament()'), true);
  assert.deepEqual(calls.map(c => c[0]), ['upsert']);
  assert.equal(calls[0][1].user_id, 'u1');
  assert.equal(calls[0][1].client_uid, ctx.APP.tourneyUid || get('readActiveTournament()').state.tourneyUid);
  assert.equal(calls[0][2].onConflict, 'user_id,client_uid');
  assert.equal(get('readActiveTournament()').state.ownerId, 'u1');
  assert.equal(get('pendingTournament()'), null);
  assert.equal(get('readActiveTournament()').state._savedTournamentId, 't1');
});

test('correção de placar depois de salvo faz UPDATE do mesmo registro', async () => {
  const { ctx, get } = torneioTerminado();
  const calls = [];
  ctx.SUPA = fakeSupa(calls); ctx.SUPA_USER = { id: 'u1' };
  await get('saveTournament()');
  assert.equal(ctx.APP._savedTournamentId, 't1');

  finalOf(ctx).sA = 6; finalOf(ctx).sB = 5;
  ctx.APP._pendingSave = true;
  await get('saveTournament()');
  assert.deepEqual(calls.map(c => c[0]), ['upsert', 'update']);
  assert.equal(calls[1][1].state.matches.find(m => m.phase === 'final').sB, 5);
  assert.equal(get('pendingTournament()'), null);
});

test('torneio em andamento não é salvo no histórico', async () => {
  const { ctx, get } = torneioTerminado();
  finalOf(ctx).sA = null; finalOf(ctx).sB = null;
  const calls = [];
  ctx.SUPA = fakeSupa(calls); ctx.SUPA_USER = { id: 'u1' };
  await get('saveTournament()');
  assert.equal(calls.length, 0);
});

test('erro ao salvar: continua pendente e registra o erro', async () => {
  const { ctx, get } = torneioTerminado();
  ctx.SUPA = fakeSupa([], { failInsert: true }); ctx.SUPA_USER = { id: 'u1' };
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a);
  try {
    assert.equal(await get('saveTournament()'), false);
  } finally { console.error = orig; }
  assert.equal(get('PENDING_SAVE_REASON'), 'error');
  assert.ok(get('pendingTournament()'));
  assert.equal(logged[0][0], '[bt8] tournament_save_failed');
  assert.equal(logged[0][1].stage, 'upsert');
});

const silenciar = async fn => {
  const orig = console.error; console.error = () => {};
  try { return await fn(); } finally { console.error = orig; }
};

test('sem a coluna client_uid (migração 002 ausente): cai no insert simples', async () => {
  const { ctx, get } = torneioTerminado();
  const calls = [];
  ctx.SUPA = fakeSupa(calls, { noClientUid: true }); ctx.SUPA_USER = { id: 'u1' };
  assert.equal(await get('saveTournament()'), true);
  assert.deepEqual(calls.map(c => c[0]), ['upsert', 'insert']);
  assert.equal(calls[1][1].client_uid, undefined);
});

test('torneio pendente de outra conta nunca é salvo na conta de quem entrou', async () => {
  const { ctx, get } = torneioTerminado();
  ctx.SUPA_USER = { id: 'uA' };
  get('saveActiveTournament()'); // A mexeu logado: dono = A
  const calls = [];
  ctx.SUPA = fakeSupa(calls); ctx.SUPA_USER = { id: 'uB' };
  assert.equal(get('pendingTournament()'), null);
  await get('savePendingTournament()');
  assert.equal(calls.length, 0);
});

test('logout apaga do aparelho o torneio do dono e o id salvo', () => {
  const { ctx, get } = torneioTerminado();
  ctx.SUPA_USER = { id: 'uA' };
  ctx.APP._savedTournamentId = 't9';
  get('saveActiveTournament()');
  assert.equal(get("forgetUserTournament('uB', { ask: false })"), true);
  assert.ok(get('readActiveTournament()'), 'torneio de A continua para outro usuário que não é o dono');
  assert.equal(get("forgetUserTournament('uA', { ask: false })"), true);
  assert.equal(get('readActiveTournament()'), null);
  assert.equal(ctx.APP._savedTournamentId, null);
  assert.equal(ctx.APP.matches.length, 0);
});

test('UPDATE sem linhas (RLS ou apagado) não vira insert de cópia', async () => {
  const { ctx, get } = torneioTerminado();
  ctx.SUPA_USER = { id: 'u1' };
  ctx.APP._savedTournamentId = 'outro';
  const calls = [];
  ctx.SUPA = fakeSupa(calls, { updateRows: [] });
  assert.equal(await silenciar(() => get('saveTournament()')), false);
  assert.deepEqual(calls.map(c => c[0]), ['update']);
  assert.equal(get('PENDING_SAVE_REASON'), 'missing');
});

test('torneio não encontrado: sem novas tentativas automáticas até "Salvar como novo"', async () => {
  const { ctx, get } = torneioTerminado();
  ctx.SUPA_USER = { id: 'u1' };
  ctx.APP._savedTournamentId = 'sumiu';
  const calls = [];
  ctx.SUPA = fakeSupa(calls, { updateRows: [] });
  await silenciar(() => get('saveTournament()'));
  assert.equal(get('readActiveTournament()').state._saveMissing, true);
  await get('savePendingTournament()'); // online / visibilitychange / reabrir o app
  assert.deepEqual(calls.map(c => c[0]), ['update'], 'não tentou de novo sozinho');
  assert.equal(get('PENDING_SAVE_REASON'), 'missing');

  await get('saveMissingAsNew()');
  await get('SAVE_IN_FLIGHT');
  assert.deepEqual(calls.map(c => c[0]), ['update', 'upsert']);
  assert.equal(get('pendingTournament()'), null);
  assert.equal(get('readActiveTournament()').state._saveMissing, false);
});

test('resposta do upsert perdida no limite do Free: nova tentativa salva sem mostrar limite', async () => {
  const { ctx, get } = torneioTerminado();
  ctx.SUPA_USER = { id: 'u1' };
  // O front contaria 3/3 (o próprio torneio já está no banco), mas o upsert vem antes.
  ctx.validateFreeSaveLimit = async () => ({ allowed: false, used: 3, limit: 3 });
  const calls = [];
  ctx.SUPA = fakeSupa(calls);
  assert.equal(await get('saveTournament()'), true);
  assert.deepEqual(calls.map(c => c[0]), ['upsert']);
  assert.equal(get('PENDING_SAVE_REASON'), null);
});

test('limite recusado pelo banco no upsert aparece como limite, não como erro', async () => {
  const { ctx, get } = torneioTerminado();
  ctx.SUPA_USER = { id: 'u1' };
  const calls = [];
  ctx.SUPA = fakeSupa(calls, { limitError: true });
  let modal = 0;
  ctx.showFreeLimitReached = () => { modal++; };
  assert.equal(await get('saveTournament()'), false);
  assert.equal(get('PENDING_SAVE_REASON'), 'limit');
  assert.equal(modal, 1);
});

test('salvamento falhou com usuário logado: torneio de visitante passa a ser dele e sai no logout', async () => {
  const { ctx, get } = torneioTerminado();
  get('saveActiveTournament()'); // visitante: dono nulo
  get('APP.matches = []; APP.tourneyUid = null'); // app reaberto, só o aparelho tem o torneio
  assert.equal(get('readActiveTournament()').state.ownerId ?? null, null);
  ctx.SUPA_USER = { id: 'uA' };
  ctx.SUPA = fakeSupa([], { failInsert: true });
  await silenciar(() => get('savePendingTournament()'));
  assert.equal(get('readActiveTournament()').state.ownerId, 'uA');
  get("forgetUserTournament('uA', { ask: false })");
  assert.equal(get('readActiveTournament()'), null);
});

test('várias abas: snapshot já salvo por outra aba mantém o id e a correção vira UPDATE', async () => {
  const { ctx, get, store } = torneioTerminado();
  ctx.SUPA_USER = { id: 'u1' };
  get('saveActiveTournament()');
  // Outra aba salvou: o snapshot ganhou o id, mas o APP desta aba não sabe.
  const d = JSON.parse(store.get('bt8_active_tournament'));
  Object.assign(d.state, { _savedTournamentId: 't1', _savedCurrentTournament: true, _pendingSave: false });
  store.set('bt8_active_tournament', JSON.stringify(d));
  finalOf(ctx).sB = 5; ctx.APP._pendingSave = true;
  const calls = [];
  ctx.SUPA = fakeSupa(calls);
  await get('saveTournament()');
  assert.deepEqual(calls.map(c => c[0]), ['update']);
});

test('snapshot antigo já salvo (sem id) não gera novo insert numa correção', async () => {
  const { ctx, get } = torneioTerminado();
  ctx.SUPA_USER = { id: 'u1' };
  Object.assign(ctx.APP, { _savedCurrentTournament: true, _savedTournamentId: undefined, _pendingSave: true });
  const calls = [];
  ctx.SUPA = fakeSupa(calls);
  await get('saveTournament()');
  assert.equal(calls.length, 0);
  assert.equal(get('pendingTournament()'), null);
});
