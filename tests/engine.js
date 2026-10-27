// Carrega config.js + tournament.js num contexto isolado do Node, sem navegador,
// para testar os geradores de partidas e o ranking como estão no app.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function loadEngine() {
  const ctx = vm.createContext({
    console,
    APP: { players: [], matches: [], mode: null, fmt: 'rr', idaVolta: false },
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    window: {},
  });
  for (const file of ['src/js/config.js', 'src/js/tournament.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
  }
  // `const` de nível superior não vira propriedade do contexto; expõe via expressão.
  return { ctx, get: expr => vm.runInContext(expr, ctx) };
}

const pairKey = (a, b) => [a, b].sort().join('|');

// Contagem de parcerias e de confrontos individuais em partidas rotativas (pA0+pA1 x pB0+pB1).
function rotationStats(matches) {
  const partners = {}, opponents = {}, perRound = {};
  for (const m of matches) {
    if (m.phase !== 'round') continue;
    const k1 = pairKey(m.pA0, m.pA1), k2 = pairKey(m.pB0, m.pB1);
    partners[k1] = (partners[k1] || 0) + 1;
    partners[k2] = (partners[k2] || 0) + 1;
    for (const a of [m.pA0, m.pA1]) for (const b of [m.pB0, m.pB1]) {
      const k = pairKey(a, b);
      opponents[k] = (opponents[k] || 0) + 1;
    }
    (perRound[m.roundNum] = perRound[m.roundNum] || []).push(m.pA0, m.pA1, m.pB0, m.pB1);
  }
  return { partners, opponents, perRound };
}

module.exports = { loadEngine, pairKey, rotationStats };
