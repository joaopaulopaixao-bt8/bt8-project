const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/js/championship');

const duplas = n => Array.from({ length: n }, (_, i) => ({ id: 'T' + (i + 1) }));
const jogo = (a, b, ga, gb, extra = {}) => ({ a, b, games_a: ga, games_b: gb, status: 'encerrada', ...extra });
const ordem = r => r.tabela.map(l => l.team);

// ── Grupos ────────────────────────────────────────────────
test('tamanhos dos grupos seguem os exemplos da seção 5', () => {
  assert.deepEqual(C.tamanhosGrupos(8), [4, 4]);
  assert.deepEqual(C.tamanhosGrupos(9), [3, 3, 3]);
  assert.deepEqual(C.tamanhosGrupos(10), [4, 3, 3]);
  assert.deepEqual(C.tamanhosGrupos(11), [4, 4, 3]);
  assert.deepEqual(C.tamanhosGrupos(13), [4, 3, 3, 3]);
  assert.deepEqual(C.tamanhosGrupos(5), [5]);
  assert.throws(() => C.tamanhosGrupos(2));
  assert.throws(() => C.tamanhosGrupos(33));
});

test('montarGrupos de 6 a 32 duplas: ceil(n/4) grupos de 3 ou 4, todas as duplas uma vez', () => {
  for (let n = 6; n <= 32; n++) {
    const r = C.montarGrupos(duplas(n), { semente: n });
    assert.equal(r.grupos.length, Math.ceil(n / 4));
    assert.ok(r.grupos.every(g => g.duplas.length === 3 || g.duplas.length === 4), `n=${n}`);
    const todas = r.grupos.flatMap(g => g.duplas);
    assert.equal(new Set(todas).size, n);
  }
});

test('menos de 6 duplas vira grupo único com final entre 1º e 2º', () => {
  const r = C.montarGrupos(duplas(5), { semente: 1 });
  assert.equal(r.grupoUnico, true);
  assert.equal(r.grupos[0].duplas.length, 5);
  const chave = C.gerarChave(['A']);
  assert.equal(chave.partidas.length, 1);
  assert.deepEqual([chave.partidas[0].origem_a, chave.partidas[0].origem_b], [{ grupo: 'A', pos: 1 }, { grupo: 'A', pos: 2 }]);
  assert.equal(C.jogosDoGrupo(r.grupos[0].duplas).length, 10);
});

test('semente salva reproduz o sorteio; cabeças de chave em grupos distintos, em serpentina', () => {
  const ds = duplas(16).map((d, i) => (i < 8 ? { ...d, seed: i + 1 } : d));
  const r1 = C.montarGrupos(ds, { semente: 12345 });
  assert.deepEqual(C.montarGrupos(ds, { semente: 12345 }), r1);
  assert.notDeepEqual(C.montarGrupos(ds, { semente: 999 }).grupos, r1.grupos);
  assert.deepEqual(r1.grupos.map(g => g.duplas[0]), ['T1', 'T2', 'T3', 'T4']);
  assert.deepEqual(r1.grupos.map(g => g.duplas[1]), ['T8', 'T7', 'T6', 'T5']);
  const sem = C.montarGrupos(duplas(10));
  assert.equal(typeof sem.semente, 'number');
  assert.deepEqual(C.montarGrupos(duplas(10), { semente: sem.semente }), sem);
});

test('jogosDoGrupo segue a ordem oficial para grupos de 3 e 4', () => {
  const p = j => [j.rodada, j.a, j.b];
  assert.deepEqual(C.jogosDoGrupo([1, 2, 3, 4]).map(p), [[1, 1, 4], [1, 2, 3], [2, 1, 3], [2, 4, 2], [3, 1, 2], [3, 3, 4]]);
  assert.deepEqual(C.jogosDoGrupo([1, 2, 3]).map(p), [[1, 2, 3], [2, 1, 3], [3, 1, 2]]);
});

// ── Classificação ─────────────────────────────────────────
test('classificação por vitórias e empate duplo pelo confronto direto', () => {
  const d = C.classificarGrupo(['A', 'B', 'C'], [jogo('A', 'B', 4, 6), jogo('A', 'C', 6, 0), jogo('B', 'C', 6, 0)]);
  assert.deepEqual(ordem(d), ['B', 'A', 'C']);
  assert.equal(d.tabela[0].criterio, 'vitórias');
  // A e B com 2 vitórias: B tem saldo maior, mas A venceu B.
  const cd = C.classificarGrupo(['A', 'B', 'C', 'D'], [
    jogo('A', 'B', 6, 5), jogo('A', 'C', 6, 5), jogo('D', 'A', 6, 0),
    jogo('B', 'C', 6, 0), jogo('B', 'D', 6, 0), jogo('C', 'D', 6, 0),
  ]);
  assert.deepEqual(ordem(cd).slice(0, 2), ['A', 'B']);
  assert.equal(cd.tabela[0].criterio, 'confronto direto');
  assert.ok(cd.tabela[1].saldo > cd.tabela[0].saldo);
});

test('empate triplo: saldo entre as empatadas e, sobrando 2, volta ao confronto direto', () => {
  // 1>2 6x2, 2>3 6x3, 3>1 6x4; todos vencem 4. Mini-saldo: 1:+2, 2:−1, 3:−1 → 1; depois 2>3 no confronto.
  const r = C.classificarGrupo(['1', '2', '3', '4'], [
    jogo('1', '2', 6, 2), jogo('2', '3', 6, 3), jogo('3', '1', 6, 4),
    jogo('1', '4', 6, 0), jogo('2', '4', 6, 0), jogo('3', '4', 6, 0),
  ]);
  assert.deepEqual(ordem(r), ['1', '2', '3', '4']);
  assert.deepEqual(r.tabela.map(l => l.criterio), ['saldo entre empatadas', 'confronto direto', 'confronto direto', 'vitórias']);
});

test('empate triplo com mini-saldo igual cai para o saldo no grupo', () => {
  const r = C.classificarGrupo(['1', '2', '3', '4'], [
    jogo('1', '2', 6, 3), jogo('2', '3', 6, 3), jogo('3', '1', 6, 3),
    jogo('1', '4', 6, 0), jogo('2', '4', 6, 1), jogo('3', '4', 6, 2),
  ]);
  assert.deepEqual(ordem(r), ['1', '2', '3', '4']);
  assert.equal(r.tabela[0].criterio, 'saldo no grupo');
});

test('empate total pede sorteio e usa o sorteio registrado', () => {
  const jogos = [jogo('A', 'B', 6, 3), jogo('B', 'C', 6, 3), jogo('C', 'A', 6, 3)];
  const r = C.classificarGrupo(['A', 'B', 'C'], jogos);
  assert.deepEqual(r.pendenteSorteio, [['A', 'B', 'C']]);
  const s = C.classificarGrupo(['A', 'B', 'C'], jogos, { sorteio: ['C', 'A', 'B'] });
  assert.deepEqual(ordem(s), ['C', 'A', 'B']);
  assert.deepEqual(s.pendenteSorteio, []);
  assert.equal(s.tabela[0].criterio, 'sorteio');
});

// D desiste depois de vencer A; os outros jogos de D não aconteceram.
const comDesistente = [
  jogo('A', 'D', 4, 6), jogo('A', 'B', 6, 2), jogo('A', 'C', 6, 3), jogo('B', 'C', 6, 4),
  { a: 'B', b: 'D', status: 'agendada' }, { a: 'C', b: 'D', status: 'agendada' },
];

test('desistência "anular todos os jogos" (grupo de 4)', () => {
  const r = C.classificarGrupo(['A', 'B', 'C', 'D'], comDesistente, { desistentes: ['D'] });
  assert.deepEqual(ordem(r), ['A', 'B', 'C', 'D']);
  assert.deepEqual(r.tabela.map(l => l.vitorias), [2, 1, 0, 0]);
  assert.equal(r.tabela[0].jogos, 2);
  assert.equal(r.tabela[3].desistente, true);
});

test('desistência "manter os feitos e WO no restante" (grupo de 4)', () => {
  const r = C.classificarGrupo(['A', 'B', 'C', 'D'], comDesistente, { desistentes: ['D'], desistencia_modo: 'wo' });
  // A 2v (perdeu para D); B 2v (C e WO de D); A>B no confronto; C 1v (WO).
  assert.deepEqual(ordem(r), ['A', 'B', 'C', 'D']);
  assert.deepEqual(r.tabela.map(l => l.vitorias), [2, 2, 1, 1]);
  assert.equal(r.tabela[1].jogos, 3);
  assert.equal(r.tabela[1].gp, 2 + 6 + 6); // 2 vs A, 6 vs C, WO 6x0
  const fora = C.classificarGrupo(['A', 'B', 'C', 'D'], comDesistente, { desistentes: ['D'], desistencia_modo: 'wo', wo_conta_saldo: false });
  assert.equal(fora.tabela[1].gp, 2 + 6);
});

test('desistência em grupo de 3, nos dois modos', () => {
  const jogos = [jogo('B', 'C', 6, 4), jogo('A', 'C', 6, 1), { a: 'A', b: 'B', status: 'agendada' }];
  const anular = C.classificarGrupo(['A', 'B', 'C'], jogos, { desistentes: ['A'] });
  assert.deepEqual(ordem(anular), ['B', 'C', 'A']);
  assert.equal(anular.tabela[1].jogos, 1);
  const wo = C.classificarGrupo(['A', 'B', 'C'], jogos, { desistentes: ['A'], desistencia_modo: 'wo' });
  assert.deepEqual(ordem(wo), ['B', 'C', 'A']);
  assert.deepEqual(wo.tabela.map(l => l.vitorias), [2, 0, 1]);
});

test('WO 6x0 dentro ou fora do saldo muda o desempate', () => {
  // a>b 6x4, b>c por WO, c>a 6x2: triplo de 1 vitória.
  const jogos = [jogo('a', 'b', 6, 4), { a: 'b', b: 'c', status: 'wo', wo: true, vencedor: 'a' }, jogo('c', 'a', 6, 2)];
  assert.deepEqual(ordem(C.classificarGrupo(['a', 'b', 'c'], jogos)), ['b', 'c', 'a']);
  assert.deepEqual(ordem(C.classificarGrupo(['a', 'b', 'c'], jogos, { wo_conta_saldo: false })), ['c', 'a', 'b']);
});

test('WO duplo anula a partida', () => {
  const r = C.classificarGrupo(['a', 'b', 'c'], [
    { a: 'a', b: 'b', status: 'wo', wo: true, vencedor: null }, jogo('a', 'c', 6, 0), jogo('b', 'c', 6, 0),
  ]);
  assert.deepEqual(r.tabela.map(l => l.jogos), [1, 1, 2]);
  assert.deepEqual(r.pendenteSorteio, [['a', 'b']]);
});

test('compararEntreGrupos: aproveitamento, saldo médio, games pró por jogo e sorteio', () => {
  const l = (team, jogos, vitorias, saldo, gp) => ({ team, jogos, vitorias, saldo, gp });
  const r = C.compararEntreGrupos([l('x', 3, 2, 4, 15), l('y', 2, 2, 1, 12), l('z', 3, 2, 4, 16), l('w', 2, 1, 6, 12)]);
  assert.deepEqual(r.ordem.map(x => x.team), ['y', 'z', 'x', 'w']);
  const emp = [l('p', 3, 2, 3, 15), l('q', 3, 2, 3, 15)];
  assert.deepEqual(C.compararEntreGrupos(emp).pendenteSorteio, [['p', 'q']]);
  assert.deepEqual(C.compararEntreGrupos(emp, ['q', 'p']).ordem.map(x => x.team), ['q', 'p']);
});

// ── Mata-mata ─────────────────────────────────────────────
const nomes = g => 'ABCDEFGH'.slice(0, g).split('');
const orig = o => (o.grupo ? o.pos + o.grupo : JSON.stringify(o));

test('cruzamentos de 2, 4 e 8 grupos', () => {
  const r1 = g => C.gerarChave(nomes(g)).partidas.filter(p => p.rodada === 1).map(p => orig(p.origem_a) + 'x' + orig(p.origem_b));
  assert.deepEqual(r1(2), ['1Ax2B', '1Bx2A']);
  assert.deepEqual(r1(4), ['1Ax2B', '1Cx2D', '1Dx2C', '1Bx2A']);
  assert.deepEqual(r1(8), ['1Ax2B', '1Hx2G', '1Dx2C', '1Ex2F', '1Bx2A', '1Gx2H', '1Cx2D', '1Fx2E']);
  const c8 = C.gerarChave(nomes(8));
  assert.equal(c8.tamanho, 16);
  assert.equal(c8.partidas.length, 15);
  assert.deepEqual(c8.partidas.find(p => p.id === 'qf1').origem_a, { match: 'r161' });
  assert.deepEqual([c8.partidas[0].next_match_id, c8.partidas[0].next_slot, c8.partidas[1].next_slot], ['qf1', 'a', 'b']);
  assert.equal(c8.partidas.find(p => p.id === 'final').next_match_id, null);
});

// Classificações em que o grupo A tem o melhor 1º e o melhor 2º (força o conflito).
function classificacoesComConflito(g) {
  const cl = {};
  nomes(g).forEach((n, i) => {
    const v = n === 'A' ? 3 : 2;
    cl[n] = [
      { team: '1' + n, jogos: 3, vitorias: v, saldo: 10 - i, gp: 18 },
      { team: '2' + n, jogos: 3, vitorias: n === 'A' ? 2 : 1, saldo: 5 - i, gp: 12 },
      { team: '3' + n, jogos: 3, vitorias: 0, saldo: -10, gp: 3 },
    ];
  });
  return cl;
}

for (const g of [3, 5, 6, 7]) {
  test(`melhores 2ºs com ${g} grupos: vagas completas e nenhum duelo do mesmo grupo antes da semi`, () => {
    const chave = C.gerarChave(nomes(g));
    const S = g === 3 ? 4 : 8;
    assert.equal(chave.modo, 'melhores2');
    assert.equal(chave.tamanho, S);
    const r1 = C.preencherChave(chave, classificacoesComConflito(g)).filter(p => p.rodada === 1);
    const times = r1.flatMap(p => [p.team_a, p.team_b]);
    assert.equal(new Set(times).size, S);
    assert.equal(times.filter(t => t[0] === '1').length, g);
    assert.ok(times.includes('2A'), 'o melhor 2º é do grupo A');
    for (const p of r1) assert.notEqual(p.team_a.slice(1), p.team_b.slice(1), `${p.team_a} x ${p.team_b}`);
    // a origem acompanha a dupla trocada
    for (const p of r1) for (const lado of ['a', 'b']) {
      const o = p['origem_' + lado];
      if (p['team_' + lado] === '2A') assert.deepEqual(o, { melhor2: 1 });
    }
  });
}

test('avancar leva o vencedor; correção limpa o slot da partida seguinte e refaz', () => {
  let ps = C.preencherChave(C.gerarChave(['A', 'B']), {
    A: [{ team: 'a1' }, { team: 'a2' }], B: [{ team: 'b1' }, { team: 'b2' }],
  });
  ps = ps.map(p => (p.id === 'sf1' ? { ...p, vencedor: 'a', status: 'encerrada' } : p));
  ps = C.avancar(ps, 'sf1');
  assert.equal(ps.find(p => p.id === 'final').team_a, 'a1');
  // correção: o vencedor da sf1 era b2
  ps = C.limpar(ps, 'sf1');
  assert.equal(ps.find(p => p.id === 'final').team_a, null);
  ps = C.avancar(ps.map(p => (p.id === 'sf1' ? { ...p, vencedor: 'b' } : p)), 'sf1');
  assert.equal(ps.find(p => p.id === 'final').team_a, 'b2');
  assert.equal(ps.find(p => p.id === 'final').alerta_origem, false);
});

test('correção com a partida seguinte já iniciada exige "forçar" e marca alerta de origem', () => {
  let ps = C.preencherChave(C.gerarChave(['A', 'B']), {
    A: [{ team: 'a1' }, { team: 'a2' }], B: [{ team: 'b1' }, { team: 'b2' }],
  });
  ps = C.avancar(ps.map(p => (p.id === 'sf1' ? { ...p, vencedor: 'a' } : p)), 'sf1');
  ps = ps.map(p => (p.id === 'final' ? { ...p, status: 'em_jogo' } : p));
  assert.throws(() => C.limpar(ps, 'sf1'), /forçar/);
  const corr = ps.map(p => (p.id === 'sf1' ? { ...p, vencedor: 'b' } : p));
  assert.throws(() => C.avancar(corr, 'sf1'), /forçar/);
  const f = C.avancar(corr, 'sf1', { forcar: true }).find(p => p.id === 'final');
  assert.deepEqual([f.team_a, f.alerta_origem], ['b2', true]);
  assert.equal(C.limpar(ps, 'sf1', { forcar: true }).find(p => p.id === 'final').alerta_origem, true);
});

test('campeonato completo de 6 a 32 duplas: grupos, classificação, chave e campeão', () => {
  for (let n = 6; n <= 32; n++) {
    const rnd = C.mulberry32(n * 7919);
    const { grupos } = C.montarGrupos(duplas(n), { semente: n });
    const cl = {};
    for (const g of grupos) {
      const jogos = C.jogosDoGrupo(g.duplas).map(j => {
        const perde = Math.floor(rnd() * 5);
        return rnd() < 0.5 ? jogo(j.a, j.b, 6, perde) : jogo(j.a, j.b, perde, 6);
      });
      const r = C.classificarGrupo(g.duplas, jogos, { sorteio: g.duplas });
      assert.deepEqual(r.pendenteSorteio, []);
      cl[g.nome] = r.tabela;
    }
    const grupoDe = {};
    grupos.forEach(g => g.duplas.forEach(d => (grupoDe[d] = g.nome)));
    let ps = C.preencherChave(C.gerarChave(grupos.map(g => g.nome)), cl, { sorteio: duplas(n).map(d => d.id) });
    for (const p of ps.filter(p => p.rodada === 1)) {
      assert.notEqual(grupoDe[p.team_a], grupoDe[p.team_b], `n=${n}: ${p.team_a} x ${p.team_b}`);
    }
    for (const p of ps.slice()) {
      ps = ps.map(x => (x.id === p.id ? { ...x, vencedor: rnd() < 0.5 ? 'a' : 'b', status: 'encerrada' } : x));
      const atual = ps.find(x => x.id === p.id);
      assert.ok(atual.team_a && atual.team_b, `n=${n}: ${p.id} sem dupla`);
      ps = C.avancar(ps, p.id);
    }
    const final = ps.find(p => p.id === 'final');
    assert.ok(final.team_a && final.team_b && final.team_a !== final.team_b);
  }
});

// ── Placar ────────────────────────────────────────────────
test('validarPlacar preset A', () => {
  const ok = (ga, gb, ta, tb) => C.validarPlacar({ games_a: ga, games_b: gb, tb_a: ta, tb_b: tb }, 'A').ok;
  for (let lo = 0; lo <= 4; lo++) { assert.ok(ok(6, lo)); assert.ok(ok(lo, 6)); }
  assert.ok(ok(7, 5));
  assert.ok(ok(7, 6, 7, 5));
  assert.ok(ok(6, 7, 10, 12));
  assert.equal(C.validarPlacar({ games_a: 7, games_b: 6, tb_a: 7, tb_b: 5 }).vencedor, 'a');
  for (const [ga, gb, ta, tb] of [[6, 5], [6, 6], [7, 6], [7, 6, 7, 6], [7, 6, 5, 7], [7, 6, 12, 8], [8, 6], [7, 4], [6, 3, 7, 0], [5, 3], [-1, 6]]) {
    assert.equal(ok(ga, gb, ta, tb), false, `${ga}x${gb} ${ta}-${tb}`);
  }
});

test('validarPlacar preset B (emergência)', () => {
  const ok = (ga, gb, ta, tb) => C.validarPlacar({ games_a: ga, games_b: gb, tb_a: ta, tb_b: tb }, 'B').ok;
  for (let lo = 0; lo <= 2; lo++) assert.ok(ok(4, lo));
  assert.ok(ok(5, 3));
  assert.ok(ok(4, 5, 3, 7));
  for (const [ga, gb, ta, tb] of [[4, 3], [6, 2], [5, 4], [5, 2], [4, 4], [6, 4]]) assert.equal(ok(ga, gb, ta, tb), false, `${ga}x${gb}`);
});

// ── Fila ──────────────────────────────────────────────────
const at = (id, nome) => ({ id, nome: nome || id });

test('proximoApto: suspensa primeiro, atleta em duas categorias, ausência e descanso', () => {
  const agora = Date.UTC(2026, 11, 11, 14, 0);
  const fila = [
    { id: 'm1', status: 'agendada', prioridade: 1, atletas: [at('fulano', 'Fulano'), at('x1'), at('x2'), at('x3')] },
    { id: 'm2', status: 'agendada', prioridade: 2, atletas: [at('y1'), at('y2'), at('ciclano', 'Ciclano'), at('y3')] },
    { id: 'm3', status: 'agendada', prioridade: 3, atletas: [at('z1'), at('z2'), at('beltrano', 'Beltrano'), at('z3')] },
    { id: 'm4', status: 'agendada', prioridade: 4, atletas: [at('w1'), at('w2'), at('w3'), at('w4')] },
    { id: 'm5', status: 'em_jogo', prioridade: 0, atletas: [] },
    { id: 'm6', status: 'agendada', prioridade: 0, atletas: [] },
  ];
  const presentes = ['fulano', 'x1', 'x2', 'x3', 'y1', 'y2', 'y3', 'z1', 'z2', 'z3', 'beltrano', 'w1', 'w2', 'w3', 'w4'];
  // Fulano joga a categoria Mista (m1) e está na Q3 pela categoria Masculina.
  const emQuadra = { fulano: 'Q3' };
  const descanso = { agora, ultimoFim: { beltrano: agora - 7 * 60000 }, minimoMin: 15 };
  const r = C.proximoApto(fila, presentes, emQuadra, descanso);
  assert.equal(r.sugestao.id, 'm4');
  const motivo = id => r.lista.find(l => l.partida.id === id).motivos;
  assert.deepEqual(motivo('m1'), ['Fulano jogando na Q3']);
  assert.deepEqual(motivo('m2'), ['Ciclano ausente']);
  assert.deepEqual(motivo('m3'), ['Beltrano descansando (faltam 8 min)']);
  assert.deepEqual(motivo('m6'), ['Aguardando definição das duplas']);
  assert.ok(!r.lista.some(l => l.partida.id === 'm5'));
  // suspensa volta com prioridade máxima
  const susp = fila.concat([{ id: 'm9', status: 'suspensa', prioridade: 99, atletas: [at('w1'), at('w2'), at('w3'), at('w4')] }]);
  assert.equal(C.proximoApto(susp, presentes, emQuadra, descanso).sugestao.id, 'm9');
  // Fulano sai da quadra → m1 vira apto
  assert.equal(C.proximoApto(fila, presentes, {}, descanso).sugestao.id, 'm1');
});

test('preverHorarios: posição na fila ÷ quadras × 40 min, pulando o almoço', () => {
  const h = (hh, mm = 0) => Date.UTC(2026, 11, 11, hh, mm);
  const fila = Array.from({ length: 6 }, (_, i) => ({ id: 'm' + i, status: 'agendada', prioridade: i }));
  const p = C.preverHorarios(fila, { quadras: 2, inicio: h(11), pausas: [{ inicio: h(12), fim: h(13) }] });
  assert.deepEqual(p.map(x => x.previsto), [h(11), h(11), h(11, 40), h(11, 40), h(13), h(13)]);
  const real = C.preverHorarios(fila, { quadras: 3, inicio: h(8), duracoesReais: [25, 25, 25, 25, 25] });
  assert.equal(real[3].previsto, h(8, 30));
});

// ── Capacidade ────────────────────────────────────────────
test('capacidade no cenário padrão: 124 jogos para 132, sobra de 6% e alerta', () => {
  const categorias = ['Masc A', 'Masc B', 'Fem', 'Mista'].map(nome => ({ nome, duplas: 16 }));
  const r = C.capacidade({ categorias });
  assert.equal(r.jogos, 124);
  assert.deepEqual(r.porCategoria[0], { nome: 'Masc A', duplas: 16, grupos: 4, jogosGrupo: 24, jogosMata: 7, total: 31 });
  assert.deepEqual(r.capacidadePorDia, [66, 66]);
  assert.equal(r.capacidade, 132);
  assert.equal(r.sobra, 8);
  assert.equal(r.sobraPct, 6.1);
  assert.equal(r.alerta, true);
  assert.deepEqual(r.opcoes, ['Mais quadras', 'Grupos de 3', 'Preset B nos grupos', 'Começar mais cedo']);
  const folga = C.capacidade({ categorias, quadras: 6 });
  assert.equal(folga.alerta, false);
  assert.deepEqual(folga.opcoes, []);
  // melhores 2ºs: 10 duplas → 3 grupos (4,3,3) = 12 jogos + semi de 4 (3) = 15
  assert.equal(C.capacidade({ categorias: [{ nome: 'X', duplas: 10 }] }).porCategoria[0].total, 15);
});

// ── Colar lista ───────────────────────────────────────────
test('parseListaInscritos: telefones opcionais, linhas inválidas e duplicadas', () => {
  const r = C.parseListaInscritos([
    '1. Ana Souza (11) 99999-8888 / Bia Lima 11 98888-7777',
    'Carla / Dani',
    '',
    'Eva Prado',
    'Fê / 123',
    'ana souza / Gabi',
    'Helô / Íris / Jô',
    'Kel - +55 21 97777-6666 / Lu',
    'Mia / Mia',
  ].join('\n'));
  assert.deepEqual(r.duplas.map(d => [d.linha, d.atleta1.nome, d.atleta1.telefone, d.atleta2.nome, d.atleta2.telefone]), [
    [1, 'Ana Souza', '+5511999998888', 'Bia Lima', '+5511988887777'],
    [2, 'Carla', null, 'Dani', null],
    [8, 'Kel', '+5521977776666', 'Lu', null],
  ]);
  assert.deepEqual(r.invalidas.map(x => x.linha), [4, 5, 7, 9]);
  assert.deepEqual(r.duplicadas.map(x => [x.linha, x.motivo]), [[6, 'Ana Souza já está na linha 1']]);
});
