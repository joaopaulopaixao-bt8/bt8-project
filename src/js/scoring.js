// Placar do scout por GAMES (sem ponto a ponto). Módulo puro, sem DOM.
// Navegador: window.BT8Scoring. Node: require('./scoring').
//
// Estado em andamento: { games_a, games_b, tb_a, tb_b }. No tie-break os games ficam
// em 6x6 (ou 4x4 no preset B) e os pontos vão em tb_a/tb_b. O placar final do
// tie-break vira 7x6 (ou 5x4) com tb registrado — ver paraPlacarFinal.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BT8Scoring = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Preset A: 1 set até 6, tie-break a 7 no 6x6. Preset B (emergência): até 4, tie-break no 4x4.
  const ALVO = { A: 6, B: 4 };
  const alvoDe = preset => {
    if (!ALVO[preset]) throw new Error('Preset desconhecido: ' + preset);
    return ALVO[preset];
  };

  const novo = () => ({ games_a: 0, games_b: 0, tb_a: null, tb_b: null });

  const emTieBreak = (e, preset = 'A') => e.games_a === alvoDe(preset) && e.games_b === alvoDe(preset);

  // 'a' | 'b' quando o set acabou (6x≤4, 7x5, tie-break a 7 com 2 de diferença), senão null.
  function fim(e, preset = 'A') {
    const alvo = alvoDe(preset);
    const a = e.games_a, b = e.games_b;
    if (emTieBreak(e, preset)) {
      const ta = e.tb_a || 0, tb = e.tb_b || 0;
      if (ta >= 7 && ta - tb >= 2) return 'a';
      if (tb >= 7 && tb - ta >= 2) return 'b';
      return null;
    }
    if (a === alvo && b <= alvo - 2) return 'a';
    if (b === alvo && a <= alvo - 2) return 'b';
    if (a === alvo + 1 && b === alvo - 1) return 'a';
    if (b === alvo + 1 && a === alvo - 1) return 'b';
    return null;
  }

  // +1 ou −1 game para uma dupla ('a' | 'b'). No tie-break o toque mexe nos pontos do tie-break.
  // Toques que levariam a um placar impossível são ignorados (devolve o mesmo placar).
  function marcar(e, lado, delta, preset = 'A') {
    if (lado !== 'a' && lado !== 'b') throw new Error('Lado inválido: ' + lado);
    if (delta !== 1 && delta !== -1) throw new Error('Use +1 ou −1');
    const alvo = alvoDe(preset);
    const n = { ...e };
    if (delta > 0 && fim(e, preset)) return n;
    if (emTieBreak(e, preset)) {
      const k = 'tb_' + lado;
      const v = (n[k] || 0) + delta;
      if (v < 0) {
        // −1 com o tie-break zerado desfaz o game que levou ao 6x6.
        if ((n.tb_a || 0) + (n.tb_b || 0) > 0) return n;
        n['games_' + lado] -= 1;
        n.tb_a = n.tb_b = null;
        return n;
      }
      n.tb_a = n.tb_a || 0;
      n.tb_b = n.tb_b || 0;
      n[k] = v;
      return n;
    }
    const k = 'games_' + lado;
    const outro = n[lado === 'a' ? 'games_b' : 'games_a'];
    const v = n[k] + delta;
    if (v < 0) return n;
    if (v > alvo && !(v === alvo + 1 && outro === alvo - 1)) return n;
    n[k] = v;
    return n;
  }

  // Placar para gravar no fim (match_finish): tie-break vira 7x6 (ou 5x4) com os pontos registrados.
  function paraPlacarFinal(e, preset = 'A') {
    const vencedor = fim(e, preset);
    if (!vencedor) return null;
    if (emTieBreak(e, preset)) {
      return {
        games_a: e.games_a + (vencedor === 'a' ? 1 : 0),
        games_b: e.games_b + (vencedor === 'b' ? 1 : 0),
        tb_a: e.tb_a, tb_b: e.tb_b, vencedor,
      };
    }
    return { games_a: e.games_a, games_b: e.games_b, tb_a: null, tb_b: null, vencedor };
  }

  // Placar vindo do servidor (match_take, conflito) para o estado do scout: 7x6 com tie-break volta a 6x6 + tb.
  function dePlacarServidor(p, preset = 'A') {
    const alvo = alvoDe(preset);
    const e = { games_a: p.games_a || 0, games_b: p.games_b || 0, tb_a: p.tb_a ?? null, tb_b: p.tb_b ?? null };
    const hi = Math.max(e.games_a, e.games_b), lo = Math.min(e.games_a, e.games_b);
    if (hi === alvo + 1 && lo === alvo && (e.tb_a != null || e.tb_b != null)) {
      if (e.games_a > e.games_b) e.games_a = alvo; else e.games_b = alvo;
    }
    return e;
  }

  // Snapshot para o servidor: placar final quando o set acabou (7x6 + tb), senão o estado como está.
  const paraServidor = (e, preset = 'A') => {
    const f = paraPlacarFinal(e, preset);
    return f ? { games_a: f.games_a, games_b: f.games_b, tb_a: f.tb_a, tb_b: f.tb_b } : { ...e };
  };

  return { ALVO, novo, emTieBreak, fim, marcar, paraPlacarFinal, dePlacarServidor, paraServidor };
});
