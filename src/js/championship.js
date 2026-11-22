// Motor do Módulo Arena: grupos, classificação, mata-mata, fila e capacidade.
// Módulo puro, sem DOM. Navegador: window.BT8Championship. Node: require('./championship').
// Regras: docs/ARENA_PLANO.md, seções 4 e 5. NÃO usa buildEliminatoria (tournament.js).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BT8Championship = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LETRAS = 'ABCDEFGH';

  // ── Sorteio reproduzível ────────────────────────────────
  function mulberry32(semente) {
    let a = semente >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function embaralhar(lista, rnd) {
    const out = lista.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // ── Grupos ──────────────────────────────────────────────
  // g = ceil(n/4) grupos de 4 e 3, os de 4 primeiro. Menos de 6 duplas: grupo único.
  function tamanhosGrupos(n) {
    if (!(n >= 3)) throw new Error('São precisas pelo menos 3 duplas na categoria');
    if (n < 6) return [n];
    const g = Math.ceil(n / 4);
    if (g > 8) throw new Error('Máximo de 32 duplas por categoria (8 grupos)');
    const de3 = 4 * g - n;
    return Array.from({ length: g }, (_, i) => (i < g - de3 ? 4 : 3));
  }

  // duplas: [{ id, seed? }] (seed 1 = principal cabeça de chave). opts: { semente }.
  // Cabeças em ordem de seed, depois as demais embaralhadas pela semente; distribuição em serpentina.
  function montarGrupos(duplas, opts = {}) {
    const semente = opts.semente != null ? opts.semente >>> 0 : Math.floor(Math.random() * 4294967296);
    const tam = tamanhosGrupos(duplas.length);
    const cabecas = duplas.filter(d => d.seed != null).sort((x, y) => x.seed - y.seed);
    const resto = embaralhar(duplas.filter(d => d.seed == null), mulberry32(semente));
    const fila = cabecas.concat(resto);
    const grupos = tam.map((_, i) => ({ nome: LETRAS[i], duplas: [] }));
    let k = 0;
    for (let linha = 0; linha < Math.max(...tam); linha++) {
      const ordem = linha % 2 ? grupos.slice().reverse() : grupos;
      for (const g of ordem) {
        if (tam[grupos.indexOf(g)] > linha && k < fila.length) g.duplas.push(fila[k++].id);
      }
    }
    return { semente, grupoUnico: tam.length === 1, grupos };
  }

  // Ordem oficial: grupo de 4 → R1 1x4, 2x3; R2 1x3, 4x2; R3 1x2, 3x4. Grupo de 3 → 2x3, 1x3, 1x2.
  // Outros tamanhos (grupo único de 5) usam o método do círculo.
  function jogosDoGrupo(duplas) {
    const fixas = {
      3: [[1, [2, 3]], [2, [1, 3]], [3, [1, 2]]],
      4: [[1, [1, 4]], [1, [2, 3]], [2, [1, 3]], [2, [4, 2]], [3, [1, 2]], [3, [3, 4]]],
    }[duplas.length];
    if (fixas) return fixas.map(([rodada, [x, y]]) => ({ rodada, a: duplas[x - 1], b: duplas[y - 1] }));
    const roda = duplas.length % 2 ? duplas.concat([null]) : duplas.slice();
    const jogos = [];
    for (let r = 0; r < roda.length - 1; r++) {
      for (let i = 0; i < roda.length / 2; i++) {
        const a = roda[i], b = roda[roda.length - 1 - i];
        if (a != null && b != null) jogos.push({ rodada: r + 1, a, b });
      }
      roda.splice(1, 0, roda.pop());
    }
    return jogos;
  }

  // ── Classificação do grupo ──────────────────────────────
  // Resultado que conta, ou null (não jogado, anulado, WO duplo).
  function resultado(j) {
    if (j.status !== 'encerrada' && j.status !== 'wo') return null;
    if (j.wo || j.status === 'wo') {
      if (j.vencedor !== 'a' && j.vencedor !== 'b') return null; // WO duplo: partida anulada
      return { vencedor: j.vencedor, ga: j.vencedor === 'a' ? 6 : 0, gb: j.vencedor === 'b' ? 6 : 0, wo: true };
    }
    const ga = j.games_a, gb = j.games_b;
    const vencedor = j.vencedor || (ga > gb ? 'a' : gb > ga ? 'b' : null);
    return vencedor ? { vencedor, ga, gb, wo: false } : null;
  }

  function estatisticas(ids, jogos, woSaldo) {
    const s = {};
    for (const id of ids) s[id] = { team: id, jogos: 0, vitorias: 0, derrotas: 0, gp: 0, gc: 0, saldo: 0 };
    for (const j of jogos) {
      const A = s[j.a], B = s[j.b];
      if (!A || !B) continue;
      A.jogos++; B.jogos++;
      (j.vencedor === 'a' ? A : B).vitorias++;
      (j.vencedor === 'a' ? B : A).derrotas++;
      if (!j.wo || woSaldo) { A.gp += j.ga; A.gc += j.gb; B.gp += j.gb; B.gc += j.ga; }
    }
    for (const id of ids) s[id].saldo = s[id].gp - s[id].gc;
    return s;
  }

  // Agrupa ids por valor decrescente de f, mantendo a ordem original dentro de cada valor.
  function particionar(ids, f) {
    const ord = ids.slice().sort((x, y) => f(y) - f(x));
    const partes = [];
    for (const id of ord) {
      const ult = partes[partes.length - 1];
      if (ult && f(ult[0]) === f(id)) ult.push(id);
      else partes.push([id]);
    }
    return partes;
  }

  // duplas: ids na ordem do grupo. jogos: [{ a, b, status, games_a, games_b, wo, vencedor }].
  // regras: { desistencia_modo: 'anular' | 'wo', wo_conta_saldo: bool, desistentes: [ids], sorteio: [ids] }.
  // Devolve { tabela: [{ pos, team, jogos, vitorias, derrotas, gp, gc, saldo, criterio, desistente }], pendenteSorteio: [[ids]] }.
  function classificarGrupo(duplas, jogos, regras = {}) {
    const modoWo = regras.desistencia_modo === 'wo';
    const woSaldo = regras.wo_conta_saldo !== false;
    const desist = new Set(regras.desistentes || []);
    const sorteio = regras.sorteio || [];
    const validos = [];
    for (const j of jogos) {
      const da = desist.has(j.a), db = desist.has(j.b);
      if ((da || db) && !modoWo) continue; // "anular todos os jogos da dupla"
      let r = resultado(j);
      // "manter os feitos e WO no restante": jogo não disputado contra a desistente vira WO.
      if (!r && da !== db && j.status !== 'anulada') {
        const v = da ? 'b' : 'a';
        r = { vencedor: v, ga: v === 'a' ? 6 : 0, gb: v === 'b' ? 6 : 0, wo: true };
      }
      if (r) validos.push({ a: j.a, b: j.b, ...r });
    }
    const geral = estatisticas(duplas, validos, woSaldo);
    const criterio = {};
    const pendenteSorteio = [];

    const sortear = ids => {
      if (ids.every(id => sorteio.includes(id))) {
        ids.forEach(id => (criterio[id] = 'sorteio'));
        return ids.slice().sort((x, y) => sorteio.indexOf(x) - sorteio.indexOf(y));
      }
      pendenteSorteio.push(ids.slice());
      ids.forEach(id => (criterio[id] = 'sorteio pendente'));
      return ids.slice();
    };
    const gerais = [
      { nome: 'saldo no grupo', f: id => geral[id].saldo },
      { nome: 'games pró', f: id => geral[id].gp },
    ];
    const porCriterios = (ids, criterios) => {
      for (const c of criterios) {
        const partes = particionar(ids, c.f);
        if (partes.length > 1) {
          return partes.flatMap(p => {
            if (p.length === 1) criterio[p[0]] = c.nome;
            return desempatar(p);
          });
        }
      }
      return sortear(ids);
    };
    function desempatar(ids) {
      if (ids.length === 1) return ids;
      if (ids.length === 2) {
        const h = validos.find(j => ids.includes(j.a) && ids.includes(j.b));
        if (h) {
          const w = h.vencedor === 'a' ? h.a : h.b;
          ids.forEach(id => (criterio[id] = 'confronto direto'));
          return [w, ids[0] === w ? ids[1] : ids[0]];
        }
        return porCriterios(ids, gerais);
      }
      const mini = estatisticas(ids, validos, woSaldo);
      return porCriterios(ids, [{ nome: 'saldo entre empatadas', f: id => mini[id].saldo }, ...gerais]);
    }

    const ativos = duplas.filter(id => !desist.has(id));
    const ordem = particionar(ativos, id => geral[id].vitorias).flatMap(p => {
      if (p.length === 1) criterio[p[0]] = 'vitórias';
      return desempatar(p);
    });
    for (const id of duplas) if (desist.has(id)) { ordem.push(id); criterio[id] = 'desistência'; }
    const tabela = ordem.map((id, i) => ({
      pos: i + 1, ...geral[id], criterio: criterio[id], desistente: desist.has(id),
    }));
    return { tabela, pendenteSorteio };
  }

  // Comparação entre grupos (melhores 1ºs e 2ºs): aproveitamento → saldo médio → games pró por jogo → sorteio.
  // linhas: linhas da tabela de classificarGrupo. Devolve { ordem, pendenteSorteio }.
  function compararEntreGrupos(linhas, sorteio = []) {
    const por = (l, k) => (l.jogos ? l[k] / l.jogos : 0);
    const chaves = [l => por(l, 'vitorias'), l => por(l, 'saldo'), l => por(l, 'gp')];
    const cmp = (x, y) => {
      for (const f of chaves) if (f(x) !== f(y)) return f(y) - f(x);
      return 0;
    };
    const idx = l => (sorteio.includes(l.team) ? sorteio.indexOf(l.team) : Infinity);
    const ordem = linhas.slice().sort((x, y) => cmp(x, y) || idx(x) - idx(y));
    const pendenteSorteio = [];
    for (let i = 0; i < ordem.length; ) {
      let k = i + 1;
      while (k < ordem.length && cmp(ordem[i], ordem[k]) === 0) k++;
      const bloco = ordem.slice(i, k);
      if (bloco.length > 1 && bloco.some(l => idx(l) === Infinity)) pendenteSorteio.push(bloco.map(l => l.team));
      i = k;
    }
    return { ordem, pendenteSorteio };
  }

  // ── Mata-mata ───────────────────────────────────────────
  // Ordem padrão de seeds: 4 → 1,4,2,3; 8 → 1,8,4,5,2,7,3,6; 16 → 1,16,8,9,...
  function ordemSeeds(S) {
    let o = [1, 2];
    while (o.length < S) {
      const t = o.length * 2 + 1;
      o = o.flatMap(s => [s, t - s]);
    }
    return o;
  }

  const FASES = { 2: ['final'], 4: ['sf', 'final'], 8: ['qf', 'sf', 'final'], 16: ['r16', 'qf', 'sf', 'final'] };

  function montarChave(S, pares) {
    const partidas = [];
    let anterior = null;
    FASES[S].forEach((fase, r) => {
      const atual = [];
      for (let k = 0; k < S / 2 ** (r + 1); k++) {
        const id = fase === 'final' ? 'final' : fase + (k + 1);
        const p = {
          id, fase, rodada: r + 1, slot: k + 1, team_a: null, team_b: null, vencedor: null,
          origem_a: r ? { match: anterior[2 * k].id } : pares[k][0],
          origem_b: r ? { match: anterior[2 * k + 1].id } : pares[k][1],
          next_match_id: null, next_slot: null, alerta_origem: false,
        };
        if (r) {
          Object.assign(anterior[2 * k], { next_match_id: id, next_slot: 'a' });
          Object.assign(anterior[2 * k + 1], { next_match_id: id, next_slot: 'b' });
        }
        atual.push(p);
      }
      partidas.push(...atual);
      anterior = atual;
    });
    return partidas;
  }

  // Cruzamentos fixos [grupo do 1º, grupo do 2º]: o 1º e o 2º do mesmo grupo só se cruzam na final.
  const CRUZAMENTOS = {
    2: [[0, 1], [1, 0]],
    4: [[0, 1], [2, 3], [3, 2], [1, 0]],
    8: [[0, 1], [7, 6], [3, 2], [4, 5], [1, 0], [6, 7], [2, 3], [5, 4]],
  };

  // nomes: ['A','B',...]. Devolve { tamanho, modo, partidas } com as vagas (origem_a/origem_b):
  // { grupo, pos } | { melhor1: n } (n-ésimo melhor 1º) | { melhor2: n } | { match: id }.
  function gerarChave(nomes, opts = {}) {
    const classificam = opts.classificam || 2;
    const g = nomes.length;
    const vaga = (i, pos) => ({ grupo: nomes[i], pos });
    if (g === 1) {
      if (classificam !== 2) throw new Error('Grupo único exige 2 classificados (final entre 1º e 2º)');
      return { tamanho: 2, modo: 'unico', partidas: montarChave(2, [[vaga(0, 1), vaga(0, 2)]]) };
    }
    if (classificam === 1) {
      if (!CRUZAMENTOS[g]) throw new Error('Com 1 classificado por grupo, use 2, 4 ou 8 grupos');
      const o = ordemSeeds(g);
      const pares = [];
      for (let i = 0; i < g; i += 2) pares.push([vaga(o[i] - 1, 1), vaga(o[i + 1] - 1, 1)]);
      return { tamanho: g, modo: 'fixo', partidas: montarChave(g, pares) };
    }
    if (CRUZAMENTOS[g]) {
      const pares = CRUZAMENTOS[g].map(([x, y]) => [vaga(x, 1), vaga(y, 2)]);
      return { tamanho: 2 * g, modo: 'fixo', partidas: montarChave(2 * g, pares) };
    }
    if (g > 8) throw new Error('Máximo de 8 grupos');
    // 3, 5, 6 ou 7 grupos: todos os 1ºs + melhores 2ºs completam 4 ou 8 vagas.
    const S = g === 3 ? 4 : 8;
    const o = ordemSeeds(S).map(s => (s <= g ? { melhor1: s } : { melhor2: s - g }));
    const pares = [];
    for (let i = 0; i < S; i += 2) pares.push([o[i], o[i + 1]]);
    return { tamanho: S, modo: 'melhores2', partidas: montarChave(S, pares) };
  }

  // Preenche a 1ª rodada com as duplas classificadas. classificacoes: { A: tabela, B: tabela, ... }
  // (tabela = classificarGrupo().tabela). No modo melhores 2ºs, troca vagas para que ninguém do
  // mesmo grupo se cruze na 1ª rodada. Devolve as partidas novas (as vagas trocadas levam a origem junto).
  function preencherChave(chave, classificacoes, opts = {}) {
    const sorteio = opts.sorteio || [];
    const nomes = Object.keys(classificacoes);
    const grupoDe = {};
    for (const n of nomes) for (const l of classificacoes[n]) grupoDe[l.team] = n;
    const melhores = pos => compararEntreGrupos(
      nomes.filter(n => classificacoes[n][pos - 1]).map(n => classificacoes[n][pos - 1]), sorteio).ordem;
    const m1 = melhores(1), m2 = melhores(2);
    const resolver = o => {
      const l = o.grupo ? classificacoes[o.grupo][o.pos - 1] : o.melhor1 ? m1[o.melhor1 - 1] : m2[o.melhor2 - 1];
      if (!l) throw new Error('Vaga sem dupla classificada: ' + JSON.stringify(o));
      return l.team;
    };
    const partidas = chave.partidas.map(p => ({ ...p }));
    const r1 = partidas.filter(p => p.rodada === 1);
    for (const p of r1) { p.team_a = resolver(p.origem_a); p.team_b = resolver(p.origem_b); }
    const conflito = (a, b) => grupoDe[a] === grupoDe[b];
    for (const p of r1) {
      if (!conflito(p.team_a, p.team_b)) continue;
      const alvo = r1.find(o => o !== p && !conflito(p.team_a, o.team_b) && !conflito(o.team_a, p.team_b));
      if (!alvo) continue;
      [p.team_b, alvo.team_b] = [alvo.team_b, p.team_b];
      [p.origem_b, alvo.origem_b] = [alvo.origem_b, p.origem_b];
    }
    return partidas;
  }

  // Partida já começou: a vaga dela não pode ser trocada sem "forçar".
  const iniciada = p => ['em_jogo', 'suspensa', 'encerrada', 'wo'].includes(p.status);

  function seguinte(partidas, id) {
    const m = partidas.find(p => p.id === id);
    if (!m) throw new Error('Partida não encontrada: ' + id);
    const prox = m.next_match_id ? partidas.find(p => p.id === m.next_match_id) : null;
    return { m, prox, campo: 'team_' + m.next_slot };
  }

  // Leva o vencedor (m.vencedor = 'a' | 'b') para a vaga da partida seguinte.
  // Se a seguinte já começou com outra dupla na vaga, exige forcar e marca alerta_origem.
  function avancar(partidas, id, opts = {}) {
    const ps = partidas.map(p => ({ ...p }));
    const { m, prox, campo } = seguinte(ps, id);
    if (m.vencedor !== 'a' && m.vencedor !== 'b') throw new Error('Partida sem vencedor');
    if (!prox) return ps;
    const time = m['team_' + m.vencedor];
    if (prox[campo] === time) return ps;
    if (iniciada(prox) && prox[campo] != null) {
      if (!opts.forcar) throw new Error('A partida seguinte já começou: só o gestor pode corrigir com "forçar"');
      prox.alerta_origem = true;
    }
    prox[campo] = time;
    return ps;
  }

  // Correção: esvazia a vaga que a partida preencheu na seguinte. Se a seguinte já começou, a vaga
  // fica como está e, com forcar, a seguinte ganha alerta_origem ("origem alterada, revisar").
  function limpar(partidas, id, opts = {}) {
    const ps = partidas.map(p => ({ ...p }));
    const { prox, campo } = seguinte(ps, id);
    if (!prox) return ps;
    if (iniciada(prox)) {
      if (!opts.forcar) throw new Error('A partida seguinte já começou: só o gestor pode corrigir com "forçar"');
      prox.alerta_origem = true;
      return ps;
    }
    prox[campo] = null;
    return ps;
  }

  // ── Placar ──────────────────────────────────────────────
  const ALVO = { A: 6, B: 4 };

  // placar: { games_a, games_b, tb_a, tb_b }. Preset A: 6x0–6x4, 7x5, 7x6 com tie-break a 7.
  // Preset B: 4x0–4x2, 5x3, 5x4 com tie-break a 7. Devolve { ok, vencedor, erro }.
  function validarPlacar(placar, preset = 'A') {
    const alvo = ALVO[preset];
    if (!alvo) return { ok: false, erro: 'Preset desconhecido: ' + preset };
    const { games_a: a, games_b: b } = placar;
    const erro = msg => ({ ok: false, vencedor: null, erro: msg });
    if (![a, b].every(v => Number.isInteger(v) && v >= 0)) return erro('Games inválidos');
    const vencedor = a > b ? 'a' : 'b';
    const hi = Math.max(a, b), lo = Math.min(a, b);
    const temTb = placar.tb_a != null || placar.tb_b != null;
    if ((hi === alvo && lo <= alvo - 2) || (hi === alvo + 1 && lo === alvo - 1)) {
      return temTb ? erro('Tie-break só existe no ' + (alvo + 1) + 'x' + alvo) : { ok: true, vencedor, erro: null };
    }
    if (hi === alvo + 1 && lo === alvo) {
      const tw = vencedor === 'a' ? placar.tb_a : placar.tb_b;
      const tl = vencedor === 'a' ? placar.tb_b : placar.tb_a;
      if (!Number.isInteger(tw) || !Number.isInteger(tl) || tl < 0) return erro('Registre o placar do tie-break');
      if (tw < 7 || tw - tl < 2 || (tw > 7 && tw - tl !== 2)) return erro('Tie-break inválido: ' + tw + '-' + tl);
      return { ok: true, vencedor, erro: null };
    }
    return erro('Placar inválido para o preset ' + preset + ': ' + a + 'x' + b);
  }

  // ── Fila global e próximo apto ──────────────────────────
  // Pendentes na ordem da fila: suspensa primeiro, depois prioridade.
  function ordenarFila(fila) {
    return fila
      .filter(p => p.status === 'agendada' || p.status === 'suspensa')
      .sort((x, y) => (y.status === 'suspensa') - (x.status === 'suspensa') || (x.prioridade || 0) - (y.prioridade || 0));
  }

  // fila: partidas com { id, status, prioridade, atletas: [{ id, nome }] x4 (vazio se a vaga não foi definida) }.
  // presentes: ids com check-in (array ou Set). emQuadra: { atletaId: 'Q3' } (partidas chamadas ou em jogo).
  // descanso: { ultimoFim: { atletaId: ms }, minimoMin = 15, agora = Date.now() }.
  // Devolve { sugestao, lista: [{ partida, apto, motivos }] }.
  function proximoApto(fila, presentes, emQuadra = {}, descanso = {}) {
    const pres = new Set(presentes || []);
    const minimo = descanso.minimoMin != null ? descanso.minimoMin : 15;
    const agora = descanso.agora != null ? descanso.agora : Date.now();
    const ultimoFim = descanso.ultimoFim || {};
    const lista = ordenarFila(fila).map(partida => {
      const motivos = [];
      const atletas = partida.atletas || [];
      if (atletas.length < 4) motivos.push('Aguardando definição das duplas');
      for (const a of atletas) {
        if (emQuadra[a.id]) motivos.push(`${a.nome} jogando na ${emQuadra[a.id]}`);
        else if (!pres.has(a.id)) motivos.push(`${a.nome} ausente`);
        else if (ultimoFim[a.id] != null) {
          const falta = Math.ceil((ultimoFim[a.id] + minimo * 60000 - agora) / 60000);
          if (falta > 0) motivos.push(`${a.nome} descansando (faltam ${falta} min)`);
        }
      }
      return { partida, apto: motivos.length === 0, motivos };
    });
    const apto = lista.find(l => l.apto);
    return { sugestao: apto ? apto.partida : null, lista };
  }

  // Previsão simples: posição na fila ÷ quadras × (duração + intervalo), pulando as pausas.
  // opts: { quadras, inicio (ms), duracaoMin = 35, intervaloMin = 5, pausas: [{ inicio, fim }] (ms),
  //         duracoesReais: [min] (com 5 ou mais, usa a média real). Devolve [{ id, previsto (ms) }].
  function preverHorarios(fila, opts = {}) {
    const quadras = Math.max(1, opts.quadras || 1);
    const reais = opts.duracoesReais || [];
    const dur = reais.length >= 5 ? reais.reduce((s, x) => s + x, 0) / reais.length : (opts.duracaoMin || 35);
    const passo = (dur + (opts.intervaloMin != null ? opts.intervaloMin : 5)) * 60000;
    const pausas = (opts.pausas || []).slice().sort((x, y) => x.inicio - y.inicio);
    let t = opts.inicio != null ? opts.inicio : Date.now();
    return ordenarFila(fila).map((p, i) => {
      if (i > 0 && i % quadras === 0) t += passo;
      for (const pz of pausas) if (t >= pz.inicio && t < pz.fim) t = pz.fim;
      return { id: p.id, previsto: t };
    });
  }

  // ── Capacidade ──────────────────────────────────────────
  const minutos = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
  const DIA_PADRAO = { inicio: '08:00', fim: '20:00', pausas: [{ inicio: '12:00', fim: '13:00' }] };
  const OPCOES_CAPACIDADE = ['Mais quadras', 'Grupos de 3', 'Preset B nos grupos', 'Começar mais cedo'];

  // cfg: { categorias: [{ nome, duplas }], quadras = 4, dias = 2 × 8h–20h com almoço 12h–13h,
  //        duracaoMin = 35, intervaloMin = 5, classificam = 2 }.
  // Capacidade por dia = quadras × horas úteis × 60 / (duração + intervalo). Alerta com sobra < 15%.
  function capacidade(cfg = {}) {
    const quadras = cfg.quadras != null ? cfg.quadras : 4;
    const dias = cfg.dias || [DIA_PADRAO, DIA_PADRAO];
    const passo = (cfg.duracaoMin || 35) + (cfg.intervaloMin != null ? cfg.intervaloMin : 5);
    const porCategoria = (cfg.categorias || []).map(c => {
      if (!(c.duplas >= 3)) return { nome: c.nome, duplas: c.duplas, grupos: 0, jogosGrupo: 0, jogosMata: 0, total: 0 };
      const tam = tamanhosGrupos(c.duplas);
      const jogosGrupo = tam.reduce((s, t) => s + (t * (t - 1)) / 2, 0);
      const jogosMata = gerarChave(LETRAS.slice(0, tam.length).split(''), { classificam: cfg.classificam || 2 }).partidas.length;
      return { nome: c.nome, duplas: c.duplas, grupos: tam.length, jogosGrupo, jogosMata, total: jogosGrupo + jogosMata };
    });
    const jogos = porCategoria.reduce((s, c) => s + c.total, 0);
    const capacidadePorDia = dias.map(d => {
      const uteis = minutos(d.fim) - minutos(d.inicio) - (d.pausas || []).reduce((s, p) => s + minutos(p.fim) - minutos(p.inicio), 0);
      return Math.floor((quadras * uteis) / passo);
    });
    const cap = capacidadePorDia.reduce((s, x) => s + x, 0);
    const sobra = cap - jogos;
    const sobraPct = cap ? Math.round((sobra / cap) * 1000) / 10 : 0;
    const alerta = sobraPct < 15;
    return { jogos, porCategoria, capacidadePorDia, capacidade: cap, sobra, sobraPct, alerta, opcoes: alerta ? OPCOES_CAPACIDADE.slice() : [] };
  }

  // ── Colar lista de inscritos ────────────────────────────
  const normalizar = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

  function e164(digitos) {
    if (digitos.length === 10 || digitos.length === 11) return '+55' + digitos;
    if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) return '+' + digitos;
    return null;
  }

  function lerAtleta(texto) {
    let s = texto.trim();
    let telefone = null;
    const m = s.match(/(\+?\(?\d[\d\s().-]{6,}\d)\s*$/);
    if (m) {
      telefone = e164(m[1].replace(/\D/g, ''));
      if (!telefone) return { erro: 'telefone inválido: ' + m[1].trim() };
      s = s.slice(0, m.index);
    }
    const nome = s.replace(/[\s\-–,;:]+$/, '').replace(/\s+/g, ' ').trim();
    if (nome.length < 2 || !/\p{L}/u.test(nome)) return { erro: 'nome vazio ou inválido' };
    return { nome, telefone };
  }

  // Uma dupla por linha: "Nome1 / Nome2", telefone opcional depois de cada nome.
  // Devolve { duplas: [{ linha, atleta1, atleta2 }], invalidas: [{ linha, texto, motivo }],
  //           duplicadas: [{ linha, texto, motivo }] }. Linhas numeradas a partir de 1.
  function parseListaInscritos(texto) {
    const duplas = [], invalidas = [], duplicadas = [];
    const atletaVisto = new Map();
    String(texto || '').split(/\r?\n/).forEach((bruta, i) => {
      const linha = i + 1;
      const t = bruta.replace(/^\s*(\d+\s*[.)-]|[-•*])\s*/, '').trim();
      if (!t) return;
      const partes = t.split('/');
      if (partes.length !== 2) return invalidas.push({ linha, texto: bruta, motivo: 'use o formato "Nome1 / Nome2"' });
      const [a1, a2] = partes.map(lerAtleta);
      const err = a1.erro || a2.erro;
      if (err) return invalidas.push({ linha, texto: bruta, motivo: err });
      if (normalizar(a1.nome) === normalizar(a2.nome)) return invalidas.push({ linha, texto: bruta, motivo: 'o mesmo nome nos dois lados' });
      const repetido = [a1, a2].map(a => atletaVisto.get(normalizar(a.nome))).find(Boolean);
      if (repetido) {
        return duplicadas.push({ linha, texto: bruta, motivo: `${repetido.nome} já está na linha ${repetido.linha}` });
      }
      atletaVisto.set(normalizar(a1.nome), { nome: a1.nome, linha });
      atletaVisto.set(normalizar(a2.nome), { nome: a2.nome, linha });
      duplas.push({ linha, atleta1: a1, atleta2: a2 });
    });
    return { duplas, invalidas, duplicadas };
  }

  return {
    mulberry32, tamanhosGrupos, montarGrupos, jogosDoGrupo, classificarGrupo, compararEntreGrupos,
    ordemSeeds, gerarChave, preencherChave, avancar, limpar, validarPlacar,
    ordenarFila, proximoApto, preverHorarios, capacidade, parseListaInscritos,
  };
});
