// Simulação de um campeonato inteiro contra o Supabase LOCAL (plano, seções 8 e 9).
// 3 categorias (16, 10 e 8 duplas), 6 quadras, 6 scouts virtuais + 1 reserva, 10% de envios
// duplicados, 5% fora de ordem, 1 troca de aparelho, 1 suspensão retomada em outra quadra e
// 1 correção "forçar" no mata-mata. Tudo pelas RPCs e pela RLS, com JWT de verdade.
// No fim confere: nenhuma partida sem resultado, classificação igual à do motor puro sobre o placar
// que a simulação mandou, e match_events coerente com o placar gravado.
//
// Uso: npm run db:start && node scripts/simular-campeonato.js [--manter] [--semente=123]
//   --manter  não apaga a arena no fim (para ver /telao/<slug> e /c/<slug> no dev:local)
// Usa src/js/championship.js (motor do A2). Recusa rodar fora de localhost, salvo --remoto
// (só para a simulação de 05/12 com a arena TESTE, com BT8_SUPABASE_URL/ANON/SERVICE no ambiente).
const { execSync } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const MANTER = args.includes('--manter');
const SEMENTE = Number((args.find(a => a.startsWith('--semente=')) || '').split('=')[1]) || Date.now() % 100000;

let C;
try { C = require(path.join(root, 'src/js/championship.js')); } catch (e) {
  console.error('Motor não encontrado em src/js/championship.js (PR do A2). A simulação depende dele.');
  process.exit(1);
}

function ambiente() {
  if (process.env.BT8_SUPABASE_URL) {
    return { url: process.env.BT8_SUPABASE_URL, anon: process.env.BT8_SUPABASE_ANON_KEY, service: process.env.BT8_SUPABASE_SERVICE_ROLE_KEY };
  }
  try {
    const s = JSON.parse(execSync('npx -y supabase@2.120.0 status -o json', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString());
    return { url: s.API_URL, anon: s.ANON_KEY, service: s.SERVICE_ROLE_KEY };
  } catch (e) {
    console.error('Supabase local não está rodando. Rode primeiro: npm run db:start');
    process.exit(1);
  }
}
const ENV = ambiente();
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(ENV.url) && !args.includes('--remoto')) {
  console.error(`Recusado: ${ENV.url} não é local. Use --remoto só com a arena TESTE e backup feito.`);
  process.exit(1);
}

const rnd = C.mulberry32(SEMENTE);
const sorte = p => rnd() < p;
const inteiro = n => Math.floor(rnd() * n);
const uuid = () => crypto.randomUUID();
const stats = { requisicoes: 0, duplicados: 0, foraDeOrdem: 0, outroAparelho: 0, conflitos: 0 };
const falhas = [];
const conferir = (cond, msg) => { if (!cond) falhas.push(msg); };

// ── HTTP ──
async function http(metodo, rota, { token, body, chave = ENV.anon, prefer } = {}) {
  stats.requisicoes++;
  const res = await fetch(`${ENV.url}/${rota}`, {
    method: metodo,
    headers: { apikey: chave, authorization: `Bearer ${token || chave}`, 'content-type': 'application/json',
      ...(prefer ? { prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const txt = await res.text();
  const data = txt ? JSON.parse(txt) : null;
  if (!res.ok) {
    const e = new Error(`${metodo} ${rota}: ${res.status} ${data?.message || data?.msg || txt}`);
    e.hint = data?.hint;
    throw e;
  }
  return data;
}
const service = (m, r, body, prefer = 'return=representation') => http(m, r, { chave: ENV.service, body, prefer });
const rest = (tok, m, r, body) => http(m, `rest/v1/${r}`, { token: tok, body, prefer: 'return=representation' });
const rpc = (tok, nome, args) => http('POST', `rest/v1/rpc/${nome}`, { token: tok, body: args });

async function criarUsuario(email) {
  const u = await service('POST', 'auth/v1/admin/users', { email, password: 'sim-senha-123', email_confirm: true });
  const s = await http('POST', 'auth/v1/token?grant_type=password', { body: { email, password: 'sim-senha-123' } });
  return { id: u.id, token: s.access_token };
}

// ── Placar: sequência de snapshots até um final válido do preset A ──
function sequenciaDePlacar() {
  const lado = sorte(0.5) ? 'a' : 'b';
  const perdedor = inteiro(7); // 0..6
  const passos = [];
  let w = 0, l = 0;
  const snap = (tbw = null, tbl = null) => passos.push(lado === 'a'
    ? { games_a: w, games_b: l, tb_a: tbw, tb_b: tbl } : { games_a: l, games_b: w, tb_a: tbl, tb_b: tbw });
  const embaralhado = (nw, nl) => {
    const s = [...Array(nw).fill('w'), ...Array(nl).fill('l')];
    for (let i = s.length - 1; i > 0; i--) { const j = inteiro(i + 1); [s[i], s[j]] = [s[j], s[i]]; }
    for (const x of s) { if (x === 'w') w++; else l++; snap(); }
  };
  if (perdedor <= 4) { embaralhado(5, perdedor); w++; snap(); }
  else if (perdedor === 5) { embaralhado(5, 5); w++; snap(); w++; snap(); }
  else {
    embaralhado(5, 5);
    if (sorte(0.5)) { w++; snap(); l++; snap(); } else { l++; snap(); w++; snap(); }
    // Regra do dono: tie-break a 7; em 6x6 nos pontos vence quem fizer 8 (8-6 ou 8-7).
    const tbw = sorte(0.7) ? 7 : 8, tbl = tbw === 7 ? inteiro(6) : 6 + inteiro(2);
    for (let i = 1; i < Math.min(tbw, 6); i++) snap(i, Math.min(i, tbl));
    w = 7; snap(tbw, tbl);
  }
  return { lado, passos };
}

(async () => {
  const sfx = `${Date.now().toString(36)}${SEMENTE}`;
  console.log(`Simulação ${sfx} (semente ${SEMENTE}) contra ${ENV.url}`);

  // ── Equipe e arena ──
  const gestor = await criarUsuario(`sim-${sfx}-gestor@bt8.test`);
  const arbitro = await criarUsuario(`sim-${sfx}-arbitro@bt8.test`);
  const scouts = [];
  for (let i = 1; i <= 7; i++) scouts.push(await criarUsuario(`sim-${sfx}-scout${i}@bt8.test`)); // 7º = reserva
  const [arena] = await service('POST', 'rest/v1/arenas', { nome: `Arena SIM ${sfx}`, slug: `sim-${sfx}`, owner_id: gestor.id });
  await service('POST', 'rest/v1/arena_members', [
    { arena_id: arena.id, user_id: gestor.id, nome: 'Gestor SIM', papel: 'dono' },
    { arena_id: arena.id, user_id: arbitro.id, nome: 'Árbitro SIM', papel: 'arbitro' },
    ...scouts.map((s, i) => ({ arena_id: arena.id, user_id: s.id, nome: `Scout ${i + 1}`, papel: 'scout' }))
  ]);
  const G = gestor.token, A = arbitro.token;

  try {
    const quadras = await rest(G, 'POST', 'courts', [1, 2, 3, 4, 5, 6].map(n => ({ arena_id: arena.id, nome: `Quadra ${n}`, ordem: n })));
    const [champ] = await rest(G, 'POST', 'championships', {
      arena_id: arena.id, titulo: 'Simulação BT8', slug: `sim-${sfx}`, status: 'em_andamento',
      regras: { desistencia_modo: 'anular', wo_conta_saldo: true, cruzamento: 'melhores2', preset: 'A' }
    });
    const formato = { tam_grupo: 4, classificam: 2, preset_grupo: 'A', preset_mata: 'A' };
    const categorias = [];
    let tel = 0;
    for (const [nome, n] of [['Masculino A', 16], ['Feminino B', 10], ['Mista C', 8]]) {
      const [cat] = await rest(G, 'POST', 'categories', { championship_id: champ.id, nome, max_duplas: n, formato });
      const atletas = await rest(G, 'POST', 'athletes', Array.from({ length: 2 * n }, (_, i) => ({
        arena_id: arena.id, nome: `${nome.split(' ')[0]} ${i + 1}`, telefone: `+55819${String(++tel).padStart(8, '0')}`
      })));
      const duplas = await rest(G, 'POST', 'teams?select=id,seed', Array.from({ length: n }, (_, i) => ({
        category_id: cat.id, athlete1_id: atletas[2 * i].id, athlete2_id: atletas[2 * i + 1].id, origem: 'importacao',
        seed: i < 2 ? i + 1 : null, presente1: true, presente2: true
      })));
      const montagem = C.montarGrupos(duplas.map(d => ({ id: d.id, seed: d.seed })), { semente: SEMENTE + categorias.length });
      const chave = C.gerarChave(montagem.grupos.map(g => g.nome), { classificam: 2 });
      const r = await rpc(G, 'category_publish_draw', {
        p_category: cat.id, p_payload: C.payloadSorteio(montagem, chave, { categoriaIndice: categorias.length })
      });
      console.log(`  ${nome}: ${n} duplas, ${montagem.grupos.length} grupos, ${r.partidas} partidas`);
      categorias.push({ ...cat, montagem, fechada: false });
    }

    // ── Dia do evento ──
    const verdade = new Map(); // match_id -> placar final enviado pela simulação
    const emAndamento = new Map(); // match_id -> { passos restantes, lado } (sobrevive à suspensão)
    const quadra = quadras.map((q, i) => ({ id: q.id, scout: scouts[i], device: uuid(), m: null }));
    const reserva = { scout: scouts[6], device: uuid() };
    let jogadas = 0, trocou = false, suspendeu = false, forcou = false;

    const todas = () => rest(G, 'GET', `matches?select=*&championship_id=eq.${champ.id}`);
    const fila = ms => ms.filter(m => ['agendada', 'suspensa'].includes(m.status) && m.team_a && m.team_b)
      .sort((x, y) => (y.status === 'suspensa') - (x.status === 'suspensa') || x.prioridade - y.prioridade);

    async function fecharCategorias(ms) {
      for (const cat of categorias.filter(c => !c.fechada)) {
        const doGrupo = ms.filter(m => m.category_id === cat.id && m.fase === 'grupo');
        if (doGrupo.some(m => !['encerrada', 'wo', 'anulada'].includes(m.status))) continue;
        const grupos = await rest(G, 'GET', `category_groups?select=id,nome&category_id=eq.${cat.id}`);
        const classif = {};
        for (const g of grupos) {
          const ids = cat.montagem.grupos.find(x => x.nome === g.nome).duplas;
          const jogos = doGrupo.filter(m => m.group_id === g.id);
          let c = C.classificarGrupo(ids, jogos, {});
          let sorteio = null;
          if (c.pendenteSorteio.length) {
            sorteio = { ordem: c.pendenteSorteio.flat().sort(() => rnd() - 0.5), observacao: 'sorteio simulado' };
            c = C.classificarGrupo(ids, jogos, { sorteio });
          }
          classif[g.nome] = c.tabela;
          await rpc(G, 'group_close', { p_group: g.id, p_sorteio: sorteio });
        }
        const mata = ms.filter(m => m.category_id === cat.id && m.fase !== 'grupo');
        const todosIds = Object.values(classif).flat().map(l => l.team).sort(() => rnd() - 0.5);
        const slots = C.slotsMataMata(C.preencherChave(mata, classif, { sorteio: todosIds }));
        await rpc(G, 'category_seed_knockout', { p_category: cat.id, p_slots: slots });
        cat.fechada = true;
        cat.classif = classif;
        console.log(`  ${cat.nome}: grupos fechados, mata-mata com ${slots.length / 2} jogos na 1ª rodada`);
      }
    }

    // Uma rodada: quadras livres puxam o próximo apto; quadras ocupadas mandam um snapshot.
    let terminou = false;
    for (let tick = 0; tick < 3000 && !terminou; tick++) {
      let ms = await todas();
      await fecharCategorias(ms);
      ms = await todas();
      if (ms.every(m => ['encerrada', 'wo', 'anulada'].includes(m.status))) { terminou = true; break; }
      const prontas = fila(ms);
      for (const q of quadra.filter(q => !q.m)) {
        const m = prontas.shift();
        if (!m) break;
        await rpc(A, 'match_call', { p_match: m.id, p_court: q.id });
        const t = await rpc(q.scout.token, 'match_take', { p_match: m.id, p_device: q.device });
        if (!emAndamento.has(m.id)) emAndamento.set(m.id, sequenciaDePlacar());
        q.m = { id: m.id, version: t.match.version, fase: m.fase, pushes: 0 };
        // Correção forçada: a 1ª semifinal começa e o gestor corrige a quartas que a alimenta.
        if (!forcou && m.fase === 'sf' && ms.some(x => x.next_match_id === m.id && x.fase === 'qf' && x.status === 'encerrada')) {
          const qf = ms.find(x => x.next_match_id === m.id && x.fase === 'qf' && x.status === 'encerrada');
          await rpc(A, 'match_start', { p_match: m.id });
          const r = await rpc(G, 'match_set_result', { p_match: qf.id, p_games_a: qf.games_b, p_games_b: qf.games_a,
            p_tb_a: qf.tb_b, p_tb_b: qf.tb_a, p_wo: false, p_motivo: 'simulação: súmula trocada', p_forcar: true });
          verdade.set(qf.id, { games_a: r.match.games_a, games_b: r.match.games_b, tb_a: r.match.tb_a, tb_b: r.match.tb_b, forcar: true });
          const sf = (await rest(G, 'GET', `matches?select=alerta_origem,version&id=eq.${m.id}`))[0];
          conferir(sf.alerta_origem, '"forçar" não marcou alerta_origem na semifinal');
          q.m.version = sf.version;
          forcou = true;
          console.log('  correção forçada aplicada numa quartas com a semifinal em jogo');
        }
      }

      await Promise.all(quadra.filter(q => q.m).map(async q => {
        const seq = emAndamento.get(q.m.id);
        const passo = seq.passos[0];
        if (!passo) { // fim: confirma
          const r = await rpc(q.scout.token, 'match_finish', { p_match: q.m.id, p_version: q.m.version, p_vencedor: seq.lado, p_device: q.device });
          conferir(r.ok, `match_finish recusado: ${JSON.stringify(r)}`);
          verdade.set(q.m.id, { ...seq.final });
          emAndamento.delete(q.m.id);
          q.m = null;
          jogadas++;
          return;
        }
        // Suspensão: 1 partida no meio, volta à fila e é retomada em outra quadra.
        if (!suspendeu && jogadas >= 6 && q.m.pushes === 3) {
          suspendeu = true; // antes do await: as quadras rodam em paralelo
          await rpc(A, 'match_suspend', { p_match: q.m.id, p_motivo: 'simulação: chuva' });
          q.m = null;
          console.log('  partida suspensa com placar parcial');
          return;
        }
        // Troca de aparelho: o reserva assume; o aparelho antigo é recusado.
        if (!trocou && jogadas >= 10 && q.m.pushes === 2) {
          trocou = true;
          const t = await rpc(reserva.scout.token, 'match_take', { p_match: q.m.id, p_device: reserva.device });
          const velho = await rpc(q.scout.token, 'match_score_push', { p_match: q.m.id, p_expected_version: q.m.version,
            p_client_event_id: uuid(), p_device: q.device, p_games_a: passo.games_a, p_games_b: passo.games_b, p_tb_a: passo.tb_a, p_tb_b: passo.tb_b });
          conferir(velho.erro === 'outro_aparelho', `aparelho antigo não foi recusado: ${JSON.stringify(velho)}`);
          stats.outroAparelho++;
          [q.scout, q.device] = [reserva.scout, reserva.device]; // o reserva segue nesta quadra
          [reserva.scout, reserva.device] = [scouts[quadra.indexOf(q)], uuid()];
          q.m.version = t.match.version;
          console.log('  troca de aparelho do scout no meio da partida');
        }
        const args = { p_match: q.m.id, p_expected_version: q.m.version, p_client_event_id: uuid(), p_device: q.device,
          p_games_a: passo.games_a, p_games_b: passo.games_b, p_tb_a: passo.tb_a, p_tb_b: passo.tb_b };
        const r = await rpc(q.scout.token, 'match_score_push', args);
        if (!r.ok) { // conflito vindo da Mesa: continua do servidor; outra recusa aqui é bug
          if (r.erro !== 'conflito') throw new Error(`push recusado sem motivo esperado: ${JSON.stringify(r)}`);
          stats.conflitos++;
          q.m.version = r.match.version;
          return;
        }
        if (sorte(0.10)) { // reenvio do mesmo evento (rede instável)
          const d = await rpc(q.scout.token, 'match_score_push', args);
          conferir(d.duplicado === true, 'reenvio com o mesmo client_event_id não veio como duplicado');
          stats.duplicados++;
        }
        if (sorte(0.05) && q.m.pushes > 0) { // snapshot velho chegando depois do novo
          const v = await rpc(q.scout.token, 'match_score_push', { ...args, p_client_event_id: uuid(), p_expected_version: q.m.version - 1 });
          conferir(v.erro === 'conflito', 'snapshot fora de ordem não deu conflito');
          stats.foraDeOrdem++;
        }
        q.m.version = r.match.version;
        q.m.pushes++;
        seq.final = seq.passos.shift();
      }));
    }

    // ── Checagens de coerência (seção 9) ──
    if (!terminou) throw new Error('a simulação não terminou (partidas presas na fila)');
    const ms = await todas();
    conferir(trocou && suspendeu && forcou, `eventos especiais faltando: troca=${trocou} suspensão=${suspendeu} forçar=${forcou}`);
    const sem = ms.filter(m => !['encerrada', 'wo'].includes(m.status) || m.vencedor == null);
    conferir(sem.length === 0, `${sem.length} partida(s) sem resultado`);
    for (const m of ms) {
      const v = verdade.get(m.id);
      if (!v) { conferir(false, `partida ${m.id} sem placar enviado pela simulação`); continue; }
      conferir(m.games_a === v.games_a && m.games_b === v.games_b && m.tb_a === v.tb_a && m.tb_b === v.tb_b,
        `placar gravado difere do enviado em ${m.id}`);
    }
    // match_events: o último placar de cada partida (ou o "depois" da correção) bate com o gravado.
    const evs = await rest(G, 'GET', `match_events?select=match_id,tipo,dados,client_event_id&championship_id=eq.${champ.id}&order=id`);
    const ids = evs.filter(e => e.client_event_id).map(e => e.match_id + e.client_event_id);
    conferir(new Set(ids).size === ids.length, 'client_event_id duplicado em match_events');
    for (const m of ms) {
      const meus = evs.filter(e => e.match_id === m.id);
      const fim = meus.filter(e => ['fim', 'forcar', 'correcao'].includes(e.tipo)).pop();
      const d = fim?.tipo === 'fim' ? fim.dados : fim?.dados?.depois;
      conferir(d && d.games_a === m.games_a && d.games_b === m.games_b, `match_events incoerente com o placar em ${m.id}`);
      const ultimoPlacar = meus.filter(e => e.tipo === 'placar').pop();
      if (fim?.tipo === 'fim') {
        conferir(ultimoPlacar && ultimoPlacar.dados.games_a === m.games_a && ultimoPlacar.dados.games_b === m.games_b,
          `último placar do scout difere do final em ${m.id}`);
      }
    }
    // Classificação: motor puro sobre o placar que a simulação enviou = motor sobre o banco = quem foi ao mata-mata.
    for (const cat of categorias) {
      for (const g of cat.montagem.grupos) {
        const doBanco = ms.filter(m => m.category_id === cat.id && m.fase === 'grupo' && g.duplas.includes(m.team_a));
        const puro = doBanco.map(m => ({ ...m, ...verdade.get(m.id), vencedor: null, status: 'encerrada' }));
        const tabelaPura = C.classificarGrupo(g.duplas, puro, { sorteio: cat.classif[g.nome].map(l => l.team) }).tabela.map(l => l.team);
        const tabelaBanco = C.classificarGrupo(g.duplas, doBanco, { sorteio: cat.classif[g.nome].map(l => l.team) }).tabela.map(l => l.team);
        conferir(JSON.stringify(tabelaPura) === JSON.stringify(tabelaBanco), `${cat.nome} grupo ${g.nome}: classificação difere do motor puro`);
        conferir(JSON.stringify(tabelaPura) === JSON.stringify(cat.classif[g.nome].map(l => l.team)),
          `${cat.nome} grupo ${g.nome}: classificação usada no fechamento difere`);
      }
      const classificados = new Set(Object.values(cat.classif).flatMap(t => t.slice(0, 2).map(l => l.team)));
      const r1 = ms.filter(m => m.category_id === cat.id && m.fase !== 'grupo' && m.origem_a && !m.origem_a.match);
      const noMata = new Set(r1.flatMap(m => [m.team_a, m.team_b]));
      conferir([...noMata].every(t => classificados.has(t)), `${cat.nome}: dupla não classificada no mata-mata`);
    }
    // Público sem telefone.
    const live = await rpc(ENV.anon, 'arena_live', { p_slug: champ.slug });
    const pub = await rpc(ENV.anon, 'arena_public', { p_slug: champ.slug });
    conferir(!/\+55/.test(JSON.stringify(live) + JSON.stringify(pub)), 'telefone apareceu no público');

    console.log(`\n${ms.length} partidas, ${stats.requisicoes} requisições, ${stats.duplicados} reenvios duplicados, ` +
      `${stats.foraDeOrdem} fora de ordem, ${stats.outroAparelho} recusa de aparelho antigo, ${stats.conflitos} conflitos.`);
    if (MANTER) console.log(`Arena mantida: /telao/${champ.slug} e /c/${champ.slug} no dev:local.`);
  } finally {
    if (!MANTER) {
      await service('DELETE', `rest/v1/arenas?id=eq.${arena.id}`, undefined, 'return=minimal');
      for (const u of [gestor, arbitro, ...scouts]) await service('DELETE', `auth/v1/admin/users/${u.id}`, undefined, 'return=minimal');
    }
  }

  if (falhas.length) {
    console.error(`\nFALHOU (${falhas.length}):\n- ` + [...new Set(falhas)].join('\n- '));
    process.exit(1);
  }
  console.log('Simulação ok: nenhuma partida sem resultado, classificação igual à do motor e match_events coerente.');
})().catch(e => { console.error(e); process.exit(1); });
