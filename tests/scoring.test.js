const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/js/scoring');
const { validarPlacar } = require('../src/js/championship');

const toques = (seq, preset = 'A') => seq.split('').reduce((e, c) => S.marcar(e, c.toLowerCase(), c === c.toLowerCase() ? 1 : -1, preset), S.novo());

test('preset A: 6x4 acaba, 6x5 não, 7x5 acaba', () => {
  assert.equal(S.fim(toques('aaaaaabbbb'), 'A'), 'a');
  const e65 = toques('aaaaabbbbba');
  assert.deepEqual([e65.games_a, e65.games_b, S.fim(e65)], [6, 5, null]);
  assert.equal(S.fim(S.marcar(e65, 'a', 1)), 'a');
  assert.deepEqual(S.paraPlacarFinal(S.marcar(e65, 'a', 1)), { games_a: 7, games_b: 5, tb_a: null, tb_b: null, vencedor: 'a' });
});

test('preset A: toque depois do fim e placar impossível são ignorados', () => {
  const e = toques('aaaaaa');
  assert.deepEqual(S.marcar(e, 'b', 1), e);
  assert.deepEqual(S.marcar(S.novo(), 'a', -1), S.novo());
  // 6x3 não vira 7x3
  const e63 = toques('aaaaaabbb');
  assert.equal(S.marcar(e63, 'a', 1).games_a, 6);
  // −1 corrige depois do fim
  assert.equal(S.marcar(e63, 'a', -1).games_a, 5);
});

test('preset A: tie-break no 6x6 até 7 com 2 de diferença e placar final 7x6', () => {
  let e = toques('aaaaabbbbbab');
  assert.ok(S.emTieBreak(e));
  for (let i = 0; i < 6; i++) e = S.marcar(S.marcar(e, 'a', 1), 'b', 1);
  assert.deepEqual([e.tb_a, e.tb_b, S.fim(e)], [6, 6, null]);
  e = S.marcar(e, 'b', 1);
  assert.equal(S.fim(e), null); // 6-7 ainda não
  e = S.marcar(S.marcar(e, 'b', -1), 'b', 1);
  e = S.marcar(e, 'b', 1);
  assert.equal(S.fim(e), 'b');
  const final = S.paraPlacarFinal(e);
  assert.deepEqual(final, { games_a: 6, games_b: 7, tb_a: 6, tb_b: 8, vencedor: 'b' });
  assert.ok(validarPlacar(final, 'A').ok);
});

test('tie-break: 7-5 acaba, 7-6 não, no 6-6 vence quem fizer 8 e não passa de 8', () => {
  const tb = (ta, tbb) => ({ games_a: 6, games_b: 6, tb_a: ta, tb_b: tbb });
  assert.equal(S.fim(tb(7, 5)), 'a');
  assert.equal(S.fim(tb(7, 6)), null);
  assert.equal(S.fim(tb(7, 7)), null);
  assert.equal(S.fim(tb(8, 7)), 'a');
  assert.equal(S.fim(tb(6, 8)), 'b');
  assert.deepEqual(S.marcar(tb(8, 6), 'a', 1), tb(8, 6));
  assert.deepEqual(S.marcar(tb(8, 7), 'b', 1), tb(8, 7));
  assert.deepEqual(S.marcar(tb(7, 7), 'b', 1), tb(7, 8));
  assert.equal(S.fim(tb(4, 7), 'A'), 'b');
  // preset B: mesma regra no 4x4
  assert.equal(S.fim({ games_a: 4, games_b: 4, tb_a: 7, tb_b: 6 }, 'B'), null);
  assert.equal(S.fim({ games_a: 4, games_b: 4, tb_a: 8, tb_b: 6 }, 'B'), 'a');
});

test('saque no tie-break pela sequência 1-2-2', () => {
  let e = { games_a: 6, games_b: 6, tb_a: 0, tb_b: 0 };
  const seq = [];
  for (let i = 0; i < 9; i++) { seq.push(S.sacaNoTieBreak(e)); e = S.marcar(e, i % 2 ? 'a' : 'b', 1); }
  assert.deepEqual(seq.join(''), 'abbaabbaa');
  assert.equal(S.sacaNoTieBreak({ games_a: 6, games_b: 6, tb_a: 0, tb_b: 0 }, 'b'), 'b');
  assert.equal(S.sacaNoTieBreak({ games_a: 6, games_b: 6, tb_a: 1, tb_b: 0 }, 'b'), 'a');
});

test('−1 com tie-break zerado volta para 6x5', () => {
  const e = S.marcar(toques('aaaaabbbbbab'), 'b', -1);
  assert.deepEqual(e, { games_a: 6, games_b: 5, tb_a: null, tb_b: null });
});

test('preset B: 4x2 acaba, 5x3 acaba, tie-break no 4x4 vira 5x4', () => {
  assert.equal(S.fim(toques('aaaabb', 'B'), 'B'), 'a');
  assert.equal(S.fim(toques('aaabbbbab', 'B'), 'B'), null); // 4x4 abre tie-break
  assert.ok(S.emTieBreak(toques('aaabbbab', 'B'), 'B'));
  let e = toques('aaabbbab', 'B');
  for (let i = 0; i < 7; i++) e = S.marcar(e, 'a', 1, 'B');
  const final = S.paraPlacarFinal(e, 'B');
  assert.deepEqual([final.games_a, final.games_b, final.tb_a, final.tb_b], [5, 4, 7, 0]);
  assert.ok(validarPlacar(final, 'B').ok);
  assert.ok(validarPlacar(S.paraPlacarFinal(toques('aaabbbaa', 'B'), 'B'), 'B').ok); // 5x3
});

test('ida e volta com o servidor: 7x6 com tie-break vira 6x6 + tb e volta a 7x6', () => {
  let e = toques('aaaaabbbbbab');
  for (let i = 0; i < 7; i++) e = S.marcar(e, 'a', 1);
  const enviado = S.paraServidor(e);
  assert.deepEqual(enviado, { games_a: 7, games_b: 6, tb_a: 7, tb_b: 0 });
  assert.deepEqual(S.dePlacarServidor(enviado), e);
  assert.deepEqual(S.paraServidor(toques('aab')), { games_a: 2, games_b: 1, tb_a: null, tb_b: null });
  assert.deepEqual(S.dePlacarServidor({ games_a: 7, games_b: 5, tb_a: null, tb_b: null }), { games_a: 7, games_b: 5, tb_a: null, tb_b: null });
  assert.deepEqual(S.dePlacarServidor({ games_a: 4, games_b: 5, tb_a: 3, tb_b: 7 }, 'B'), { games_a: 4, games_b: 4, tb_a: 3, tb_b: 7 });
});

test('todo placar final do scoring passa em validarPlacar', () => {
  let rnd = 7;
  const r = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (const preset of ['A', 'B']) {
    for (let k = 0; k < 300; k++) {
      let e = S.novo();
      while (!S.fim(e, preset)) e = S.marcar(e, r() < 0.5 ? 'a' : 'b', r() < 0.1 ? -1 : 1, preset);
      assert.ok(validarPlacar(S.paraPlacarFinal(e, preset), preset).ok, JSON.stringify(e));
    }
  }
});
