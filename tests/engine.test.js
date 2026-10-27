const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine, pairKey, rotationStats } = require('./engine');

const names = n => Array.from({ length: n }, (_, i) => 'P' + (i + 1));

function buildRotativo(mode) {
  const { ctx, get } = loadEngine();
  const n = get('MAX_PLAYERS')[mode];
  Object.assign(ctx.APP, { mode, fmt: 'rr', players: names(n).map(name => ({ name })) });
  get('buildMatches()');
  return { n, matches: ctx.APP.matches };
}

function assertNobodyTwiceInRound(perRound) {
  for (const [round, ps] of Object.entries(perRound)) {
    assert.equal(new Set(ps).size, ps.length, `rodada ${round} tem jogador repetido`);
  }
}

for (const mode of ['s4', 's6', 's8', 's12']) {
  test(`${mode}: ninguém joga duas vezes na mesma rodada e nenhuma parceria repete`, () => {
    const { matches } = buildRotativo(mode);
    const { partners, perRound } = rotationStats(matches);
    assertNobodyTwiceInRound(perRound);
    assert.equal(Math.max(...Object.values(partners)), 1);
  });
}

for (const mode of ['s4', 's8', 's12']) {
  test(`${mode}: todos os pares de jogadores fazem dupla exatamente uma vez`, () => {
    const { n, matches } = buildRotativo(mode);
    const { partners } = rotationStats(matches);
    assert.equal(Object.keys(partners).length, n * (n - 1) / 2);
  });
}

test('s12: cada jogador enfrenta cada outro exatamente 2 vezes', () => {
  const { matches } = buildRotativo('s12');
  const { opponents } = rotationStats(matches);
  assert.equal(Object.keys(opponents).length, 66);
  assert.deepEqual([...new Set(Object.values(opponents))], [2]);
});

test('s12: 11 rodadas com 3 quadras cada, ninguém descansa', () => {
  const { matches } = buildRotativo('s12');
  const { perRound } = rotationStats(matches);
  assert.equal(Object.keys(perRound).length, 11);
  for (const ps of Object.values(perRound)) assert.equal(ps.length, 12);
});

function buildMista(n) {
  const { ctx, get } = loadEngine();
  ctx.APP._mistaMen = Array.from({ length: n }, (_, i) => 'H' + i);
  ctx.APP._mistaWomen = Array.from({ length: n }, (_, i) => 'M' + i);
  get('buildMistaRotativa()');
  return ctx.APP.matches;
}

for (const n of [2, 3, 4, 5, 6, 7, 8]) {
  test(`mista ${n}H+${n}M: nenhuma dupla H+M repete e ninguém joga 2x na rodada`, () => {
    const matches = buildMista(n);
    const { partners, perRound } = rotationStats(matches);
    assertNobodyTwiceInRound(perRound);
    assert.equal(Math.max(...Object.values(partners)), 1);
    // Par: todas as n² duplas jogam. Ímpar: a dupla que folga em cada rodada não joga (n a menos).
    assert.equal(Object.keys(partners).length, n % 2 ? n * n - n : n * n);
    for (const m of matches) {
      assert.match(m.pA0, /^H/); assert.match(m.pA1, /^M/);
      assert.match(m.pB0, /^H/); assert.match(m.pB1, /^M/);
      if (m.restNames) assert.ok(!m.restNames.includes(m.pA0) && !m.restNames.includes(m.pB0));
    }
  });

  test(`mista ${n}H+${n}M: homens variam de adversário`, () => {
    const matches = buildMista(n);
    const faced = {};
    for (const m of matches) {
      const k = pairKey(m.pA0, m.pB0);
      faced[k] = (faced[k] || 0) + 1;
    }
    const menPairs = n * (n - 1) / 2;
    // Todo par de homens se enfrenta ao menos uma vez.
    assert.equal(Object.keys(faced).length, menPairs);
    // Ímpar: exatamente 1x. Par: no máximo 2x (n rodadas para n-1 adversários).
    assert.ok(Math.max(...Object.values(faced)) <= (n % 2 ? 1 : 2));
  });
}

for (const n of [3, 4, 5, 6, 7, 8]) {
  test(`duplas fixas com ${n} duplas: todos se enfrentam exatamente uma vez`, () => {
    const { ctx, get } = loadEngine();
    const ps = Array.from({ length: n }, (_, i) => ({ name: 'D' + i }));
    if (n % 2) ps.push({ name: '__BYE__' });
    Object.assign(ctx.APP, { mode: 'df', idaVolta: false, players: ps });
    get('buildMatchesRRComBye()');
    const real = ctx.APP.matches.filter(m => !m.isBye);
    const pairs = real.map(m => pairKey(m.a, m.b));
    assert.equal(new Set(pairs).size, pairs.length, 'confronto repetido');
    assert.equal(pairs.length, n * (n - 1) / 2);
  });
}

test('ranking individual: vitórias primeiro, saldo desempata', () => {
  const { get, ctx } = loadEngine();
  ctx.__m = [
    { pA0: 'A', pA1: 'B', pB0: 'C', pB1: 'D', sA: 6, sB: 2 },
    { pA0: 'A', pA1: 'C', pB0: 'B', pB1: 'D', sA: 6, sB: 4 },
    { pA0: 'A', pA1: 'D', pB0: 'B', pB1: 'C', sA: 3, sB: 6 },
  ];
  // A, B e C têm 2 vitórias; saldo: B +5, A +3, C +1. D tem 1 vitória.
  const st = get("calcIndivStandings(['A','B','C','D'], __m)");
  assert.deepEqual(Array.from(st, s => s.name), ['B', 'A', 'C', 'D']);
});

test('escapeHtml: nome de jogador nunca vira HTML', () => {
  const { get } = loadEngine();
  assert.equal(get(`escapeHtml('<b>Hugo</b>')`), '&lt;b&gt;Hugo&lt;/b&gt;');
  assert.equal(get(`escapeHtml("D'Ávila & \\"Zé\\"")`), 'D&#39;Ávila &amp; &quot;Zé&quot;');
  assert.equal(get('escapeHtml(null)'), '');
});
