// Mesa de Controle, credenciamento, substituição de dupla e exportar/imprimir (plano B). Agente A3.
// Usa os componentes e o acesso a dados de arena.js (arScreen, arForm, arenaDb...) e o motor (BT8Championship).
// Contrato: docs/ARENA.md 4.4 e 4.5.

const MESA = { timer: null, ciclo: null, ultimaAtualizacao: 0, falhaDesde: null };

const mesaMin = ts => (ts ? Math.max(0, Math.floor((Date.now() - Date.parse(ts)) / 60000)) : null);
const mesaQuadra = id => ARENA.quadras.find(q => q.id === id);
const mesaGrupo = id => ARENA.c.groups.find(g => g.id === id);
const mesaCat = id => ARENA.c.cats.find(c => c.id === id);
const mesaAtivos = m => m.status === 'chamada' || m.status === 'em_jogo';

function mesaRotulo(m) {
  const cat = mesaCat(m.category_id)?.nome || '';
  const g = m.group_id ? mesaGrupo(m.group_id) : null;
  return `${cat} · ${g ? `Grupo ${g.nome} · R${m.rodada}` : arJogoNome(m)}`;
}

const mesaNomes = m => `${arDupla(arTeam(m.team_a))} x ${arDupla(arTeam(m.team_b))}`;

function mesaPreset(m) {
  const f = arFormato(mesaCat(m.category_id));
  return m.fase === 'grupo' ? f.preset_grupo : f.preset_mata;
}

// ── Carga e polling (5 s, uma chamada por vez, 10 s de limite) ──
async function mesaBuscar() {
  const ctrl = new AbortController();
  const limite = setTimeout(() => ctrl.abort(), 10000);
  try {
    const db = arenaDb();
    const catIds = ARENA.c.cats.map(c => c.id);
    const [camps, matches, teams, groups] = await Promise.race([
      Promise.all([
        db.select('championships', { id: ARENA.c.camp.id }, null, ctrl.signal),
        db.select('matches', { championship_id: ARENA.c.camp.id }, null, ctrl.signal),
        catIds.length ? db.select('teams', { category_id: catIds }, null, ctrl.signal) : [],
        catIds.length ? db.select('category_groups', { category_id: catIds }, 'ordem', ctrl.signal) : [],
      ]),
      new Promise((_, rej) => ctrl.signal.addEventListener('abort', () => rej(new Error('O servidor demorou mais de 10 s para responder.')))),
    ]);
    Object.assign(ARENA.c, { camp: camps[0] || ARENA.c.camp, matches, teams, groups });
    MESA.ultimaAtualizacao = Date.now();
    MESA.falhaDesde = null;
  } catch (e) {
    MESA.falhaDesde = MESA.falhaDesde || Date.now();
    throw e;
  } finally {
    clearTimeout(limite);
  }
}

// Recarga depois de uma ação espera o ciclo em andamento e busca de novo (nunca redesenha dado velho).
async function mesaAtualizar() {
  if (!ARENA.c) return;
  while (MESA.ciclo) await MESA.ciclo.catch(() => {});
  MESA.ciclo = mesaBuscar();
  try {
    await MESA.ciclo;
  } finally {
    MESA.ciclo = null;
  }
}

function mesaIniciarPolling(render, telaId) {
  clearInterval(MESA.timer);
  MESA.timer = setInterval(async () => {
    if (!document.getElementById(telaId)?.classList.contains('active')) return clearInterval(MESA.timer);
    if (document.visibilityState !== 'visible' || MESA.ciclo) return;
    try {
      await mesaAtualizar();
    } catch (e) {
      console.warn('Mesa: falha ao atualizar', e);
    }
    if (!document.querySelector('.ar-modal')) render();
  }, 5000);
}

function mesaFaixaRede() {
  if (!MESA.falhaDesde) return '';
  return `<div class="mesa-rede" role="alert">${icon('alert')} Sem conexão há ${Math.round((Date.now() - MESA.falhaDesde) / 1000)} s. Os dados podem estar desatualizados.</div>`;
}

async function mesaRecarregar(render) {
  await mesaAtualizar();
  render();
}

// ── Próximo apto (motor) ─────────────────────────────────
function mesaAtletas(teamId) {
  const t = arTeam(teamId);
  if (!t) return [];
  return [t.athlete1_id, t.athlete2_id].map(id => ({ id, nome: ARENA.c.atl[id]?.nome || '?' }));
}

function mesaProximo() {
  const ms = ARENA.c.matches;
  const fila = ms.map(m => ({ ...m, atletas: m.team_a && m.team_b ? [...mesaAtletas(m.team_a), ...mesaAtletas(m.team_b)] : [] }));
  const presentes = [];
  for (const t of ARENA.c.teams) {
    if (t.presente1) presentes.push(t.athlete1_id);
    if (t.presente2) presentes.push(t.athlete2_id);
  }
  const emQuadra = {};
  const ultimoFim = {};
  for (const m of ms) {
    const ids = [...mesaAtletas(m.team_a), ...mesaAtletas(m.team_b)].map(a => a.id);
    if (mesaAtivos(m)) ids.forEach(id => { emQuadra[id] = mesaQuadra(m.court_id)?.nome || 'quadra'; });
    if (m.encerrada_em && (m.status === 'encerrada' || m.status === 'wo')) {
      const fim = Date.parse(m.encerrada_em);
      ids.forEach(id => { ultimoFim[id] = Math.max(ultimoFim[id] || 0, fim); });
    }
  }
  return BT8Championship.proximoApto(fila, presentes, emQuadra, { ultimoFim, descanso_min: arRegras().descanso_min });
}

// ── Alertas ──────────────────────────────────────────────
function mesaAlertas() {
  const R = arRegras();
  const out = [];
  for (const m of ARENA.c.matches) {
    const q = mesaQuadra(m.court_id)?.nome || 'Quadra';
    if (m.status === 'chamada' && !ARENA.c.camp.pausado && mesaMin(m.chamada_em) >= R.tolerancia_wo_min) {
      out.push({ tipo: 'err', txt: `${q}: tolerância de WO vencida (${mesaMin(m.chamada_em)} min) · ${mesaNomes(m)}` });
    }
    if (m.status === 'em_jogo' && mesaMin(m.updated_at || m.iniciada_em) >= 10) {
      out.push({ tipo: 'warn', txt: `${q}: sem atualização há ${mesaMin(m.updated_at || m.iniciada_em)} min` });
    }
    if (m.alerta_origem && !arFinal(m)) out.push({ tipo: 'err', txt: `${mesaRotulo(m)}: origem alterada, revisar` });
  }
  for (const g of arG() ? ARENA.c.groups : []) { // fechar grupo é só do gestor
    const jogos = ARENA.c.matches.filter(m => m.group_id === g.id);
    if (!g.fechado_em && jogos.length && jogos.every(arFinal)) {
      out.push({ tipo: 'ok', txt: `${mesaCat(g.category_id)?.nome} · Grupo ${g.nome} pronto para fechar`, acao: `mesaIrChave('${g.category_id}')` });
    }
  }
  return out;
}

function mesaIrChave(catId) {
  ARENA.catId = catId;
  arenaAbrirChave();
}

// ══ MESA DE CONTROLE ═════════════════════════════════════
async function mesaAbrir() {
  goTo('screen-arena-mesa');
  arScreen('screen-arena-mesa', 'Mesa de Controle', '<div class="ar-vazio">Carregando...</div>');
  try {
    if (!ARENA.quadras.length) ARENA.quadras = await arenaDb().select('courts', { arena_id: ARENA.arena.id }, 'ordem');
    await mesaAtualizar();
  } catch (e) {
    return arToast(e.message, 'erro');
  }
  mesaRender();
  mesaIniciarPolling(mesaRender, 'screen-arena-mesa');
}

function mesaColunaHtml(q) {
  const R = arRegras();
  const atual = ARENA.c.matches.filter(m => m.court_id === q.id && mesaAtivos(m))
    .sort((a, b) => (b.status === 'em_jogo') - (a.status === 'em_jogo') || String(a.chamada_em).localeCompare(String(b.chamada_em)));
  const jogo = atual[0];
  const proxBtn = `<button class="btn btn-yellow btn-sm btn-full" onclick="mesaEscolherProximo('${q.id}')">${icon('zap')} Próximo jogo</button>`;
  if (!jogo) {
    return `<div class="mesa-col livre"><div class="mesa-col-h"><b>${arEsc(q.nome)}</b>${arChip('Livre', 'mute')}</div>
      <div class="ar-vazio">Quadra livre</div>${proxBtn}</div>`;
  }
  const min = mesaMin(jogo.status === 'em_jogo' ? jogo.iniciada_em : jogo.chamada_em);
  const longo = jogo.status === 'em_jogo' && min > 1.5 * R.duracao_media_min;
  const woVencido = jogo.status === 'chamada' && !ARENA.c.camp.pausado && min >= R.tolerancia_wo_min;
  const tb = jogo.tb_a != null || jogo.tb_b != null ? `<div class="mesa-tb">TIE-BREAK ${jogo.tb_a ?? 0}-${jogo.tb_b ?? 0}</div>` : '';
  return `
    <div class="mesa-col ${jogo.status} ${longo || woVencido ? 'alerta' : ''}">
      <div class="mesa-col-h"><b>${arEsc(q.nome)}</b>${arChip(jogo.status === 'em_jogo' ? 'Em jogo' : 'Chamada', jogo.status === 'em_jogo' ? 'ok' : 'warn')}</div>
      <div class="mesa-rot">${arEsc(mesaRotulo(jogo))}</div>
      <div class="mesa-placar">
        <div class="mesa-dupla"><span>${arEsc(arDupla(arTeam(jogo.team_a)))}</span><b>${jogo.games_a ?? 0}</b></div>
        <div class="mesa-dupla"><span>${arEsc(arDupla(arTeam(jogo.team_b)))}</span><b>${jogo.games_b ?? 0}</b></div>
        ${tb}
      </div>
      <div class="mesa-info">
        <span class="${longo || woVencido ? 'ruim' : ''}">${icon('clock')} ${jogo.status === 'em_jogo' ? `${min} min de jogo${longo ? ' (acima de 1,5× a média)' : ''}` : `chamada há ${min} min${woVencido ? ' · WO liberado' : ''}`}</span>
        <span>${jogo.scout_device ? `Scout: aparelho …${arEsc(String(jogo.scout_device).slice(-4))}` : 'Sem scout: lance pela Mesa'}</span>
      </div>
      <div class="ar-botoes">
        ${jogo.status === 'chamada' ? `<button class="btn btn-primary btn-sm" onclick="mesaIniciar('${jogo.id}')">Iniciar</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="mesaPlacar('${jogo.id}')">${icon('pencil')} Placar final</button>
        <button class="btn btn-ghost btn-sm" onclick="mesaWo('${jogo.id}')">WO</button>
        <button class="btn btn-coral btn-sm" onclick="mesaSuspender('${jogo.id}')">Suspender</button>
        ${arenaPainelDemo() && jogo.status === 'em_jogo' ? `<button class="btn btn-ghost btn-sm" onclick="mesaDemoGame('${jogo.id}','a')">Demo: +1 A</button>
          <button class="btn btn-ghost btn-sm" onclick="mesaDemoGame('${jogo.id}','b')">Demo: +1 B</button>` : ''}
      </div>
      ${atual.length > 1 ? `<p class="ar-txt">Também chamada aqui: ${arEsc(mesaNomes(atual[1]))}</p>` : proxBtn}
    </div>`;
}

function mesaRender() {
  const { camp } = ARENA.c;
  const g = arG();
  const alertas = mesaAlertas();
  const quadras = ARENA.quadras.filter(q => q.ativa !== false);
  const prox = mesaProximo();
  const fila = prox.lista.slice(0, 12);
  const encerradas = ARENA.c.matches.filter(arFinal).sort((a, b) => String(b.encerrada_em || '').localeCompare(String(a.encerrada_em || ''))).slice(0, 10);
  arScreen('screen-arena-mesa', 'Mesa de Controle', `
    <div class="ar-cab">
      <div><div class="ar-titulo">${arEsc(camp.titulo)}</div>
        <div class="ar-sub">Atualizado às ${new Date(MESA.ultimaAtualizacao || Date.now()).toLocaleTimeString('pt-BR')} · a cada 5 s</div></div>
      ${g ? `<button class="btn ${camp.pausado ? 'btn-yellow' : 'btn-coral'} btn-sm" onclick="mesaPausar()">${camp.pausado ? 'Retomar evento' : 'Pausar evento'}</button>` : ''}
    </div>
    ${mesaFaixaRede()}
    ${camp.pausado ? `<div class="mesa-pausa">PAUSA${camp.pausa_motivo ? ' – ' + arEsc(camp.pausa_motivo) : ''}</div>` : ''}
    ${alertas.length ? `<div class="mesa-alertas" role="status">${alertas.map(a =>
      `<${a.acao ? `button onclick="${a.acao}"` : 'div'} class="mesa-alerta ${a.tipo}">${icon(a.tipo === 'ok' ? 'check' : 'alert')} ${arEsc(a.txt)}</${a.acao ? 'button' : 'div'}>`).join('')}</div>` : ''}
    ${quadras.length ? `<div class="mesa-quadras">${quadras.map(mesaColunaHtml).join('')}</div>`
      : `<div class="ar-alerta">${icon('alert')} Nenhuma quadra ativa. Cadastre em Minha arena &gt; Quadras.</div>`}
    <div class="ar-grid2">
      <div class="ar-card">
        <div class="ar-card-h"><div class="ar-h">Fila</div><span class="ar-sub">suspensas primeiro</span></div>
        <div class="ar-list">${fila.map(l => `
          <div class="mesa-fila ${l.apto ? 'apto' : ''}">
            <span class="ar-row-main"><b>${arEsc(l.partida.team_a ? mesaNomes(l.partida) : 'Duplas a definir')}</b>
              <small>${arEsc(mesaRotulo(l.partida))}${l.partida.status === 'suspensa' ? ' · SUSPENSA' : ''}</small>
              ${l.motivos.length ? `<small class="mesa-motivo">${arEsc(l.motivos.join(' · '))}</small>` : ''}</span>
            ${l.apto ? arChip('Apto', 'ok') : arChip('Aguardando', 'mute')}
            ${l.partida.team_a && l.partida.team_b ? `<button class="btn btn-ghost btn-sm" onclick="mesaPlacar('${l.partida.id}')" title="Lançar o placar final (súmula em papel)">Placar</button>` : ''}
          </div>`).join('') || '<div class="ar-vazio">Fila vazia.</div>'}</div>
      </div>
      <div class="ar-card">
        <div class="ar-card-h"><div class="ar-h">Encerradas</div></div>
        <div class="ar-list">${encerradas.map(m => `
          <div class="mesa-fila">
            <span class="ar-row-main"><b>${arEsc(mesaNomes(m))}</b><small>${arEsc(mesaRotulo(m))} · ${arEsc(arPlacar(m))}</small></span>
            ${!(m.group_id && mesaGrupo(m.group_id)?.fechado_em) ? `<button class="btn btn-ghost btn-sm" onclick="mesaPlacar('${m.id}')">Corrigir</button>` : arChip('Grupo fechado', 'mute')}
          </div>`).join('') || '<div class="ar-vazio">Nenhum jogo encerrado.</div>'}</div>
      </div>
    </div>`);
}

// A RPC é o que importa: se ela passou e só a recarga falhou, é sucesso com aviso, não erro.
async function mesaRpc(nome, args, ok) {
  try {
    await arenaDb().rpc(nome, args);
  } catch (e) {
    console.warn('Mesa:', e);
    return arToast(e.message || 'Algo deu errado', 'erro');
  }
  try {
    await mesaAtualizar();
    if (ok) arToast(ok);
  } catch (e) {
    arToast(`${ok || 'Feito.'} Não foi possível atualizar a tela agora; ela tenta de novo em 5 s.`);
  }
  mesaRender();
}

async function mesaEscolherProximo(quadraId) {
  const q = mesaQuadra(quadraId);
  const { sugestao, lista } = mesaProximo();
  const comDuplas = lista.filter(l => l.partida.team_a && l.partida.team_b);
  const opcoes = comDuplas.slice(0, 15);
  // A sugestão pode estar além das 15 primeiras: entra no topo da lista.
  if (sugestao && !opcoes.some(l => l.partida.id === sugestao.id)) opcoes.unshift(comDuplas.find(l => l.partida.id === sugestao.id));
  if (!opcoes.length) return arToast('Nenhum jogo na fila com as duas duplas definidas.', 'erro');
  const v = await arForm({
    titulo: `Próximo jogo · ${q.nome}`,
    texto: sugestao ? `Sugestão: <b>${arEsc(mesaNomes(sugestao))}</b>` : `<span class="ar-aviso">${icon('alert')} Nenhum jogo com os 4 atletas presentes, livres e descansados. Escolha um para chamar mesmo assim.</span>`,
    campos: [{
      nome: 'id', rotulo: 'Chamar', tipo: 'radio', valor: sugestao?.id || '', obrigatorio: true,
      opcoes: opcoes.map(l => [l.partida.id, `${mesaNomes(l.partida)} · ${mesaRotulo(l.partida)}`, l.apto ? '' : l.motivos.join(' · ')]),
    }],
    ok: 'Chamar',
  });
  if (!v) return;
  const escolha = opcoes.find(l => l.partida.id === v.id);
  if (!escolha) return arToast('Escolha um jogo da lista.', 'erro');
  if (!escolha.apto && !(await arConfirm('Jogo não apto', `${arEsc(mesaNomes(escolha.partida))}<br><span class="mesa-motivo">${arEsc(escolha.motivos.join(' · '))}</span>`, 'Chamar mesmo assim'))) return;
  // Rebusca o jogo: outro aparelho da Mesa pode ter chamado antes (match_call moveria o jogo de quadra).
  let atual;
  try {
    atual = (await arenaDb().select('matches', { id: v.id }))[0];
  } catch (e) {
    return arToast(e.message, 'erro');
  }
  if (!atual || !['agendada', 'suspensa'].includes(atual.status)) {
    const onde = atual && mesaAtivos(atual) ? ` na ${mesaQuadra(atual.court_id)?.nome || 'outra quadra'}` : '';
    arToast(`Esse jogo já foi chamado${onde}.`, 'erro');
    return mesaRecarregar(mesaRender).catch(() => {});
  }
  await mesaRpc('match_call', { p_match: atual.id, p_court: quadraId }, `Chamada: ${q.nome} – ${mesaNomes(atual)}`);
}

function mesaIniciar(id) {
  mesaRpc('match_start', { p_match: id }, 'Jogo iniciado.');
}

async function mesaSuspender(id) {
  const m = ARENA.c.matches.find(x => x.id === id);
  const v = await arForm({
    titulo: 'Suspender jogo', texto: `${arEsc(mesaNomes(m))}<br>O placar fica guardado e o jogo volta ao topo da fila.`,
    campos: [{ nome: 'motivo', rotulo: 'Motivo', tipo: 'select', valor: 'Chuva', opcoes: [['Chuva', 'Chuva'], ['Quadra interditada', 'Quadra interditada'], ['Atendimento médico', 'Atendimento médico'], ['Outro', 'Outro']] }],
    ok: 'Suspender', perigo: true,
  });
  if (!v) return;
  mesaRpc('match_suspend', { p_match: id, p_motivo: v.motivo }, 'Jogo suspenso.');
}

async function mesaWo(id) {
  const m = ARENA.c.matches.find(x => x.id === id);
  const v = await arForm({
    titulo: 'Aplicar WO', texto: 'Escolha quem <b>não</b> compareceu.',
    campos: [
      { nome: 'ausente', rotulo: 'Ausente', tipo: 'radio', valor: '', obrigatorio: true, opcoes: [['a', arDupla(arTeam(m.team_a))], ['b', arDupla(arTeam(m.team_b))], ['duplo', 'As duas (WO duplo: partida anulada)']] },
      { nome: 'motivo', rotulo: 'Motivo', obrigatorio: true, valor: 'Não compareceu no tempo de tolerância' },
    ],
    ok: 'Aplicar WO', perigo: true,
  });
  if (!v) return;
  mesaRpc('match_wo', { p_match: id, p_ausente: v.ausente, p_motivo: v.motivo }, 'WO aplicado.');
}

async function mesaPlacar(id) {
  const m = ARENA.c.matches.find(x => x.id === id);
  const preset = mesaPreset(m);
  const corrigir = arFinal(m);
  const podeForcar = arG() && m.fase !== 'grupo';
  const ladoWo = (m.wo || m.status === 'wo') && m.vencedor ? (m.vencedor === m.team_a ? 'wo_a' : 'wo_b') : 'placar';
  const v = await arForm({
    titulo: corrigir ? 'Corrigir placar' : 'Lançar placar final',
    texto: `${arEsc(mesaRotulo(m))} · preset ${arEsc(preset)}${corrigir ? ` · atual ${arEsc(arPlacar(m))}` : ''}`,
    campos: [
      // Corrigir um WO não pode apagá-lo sem querer: o tipo de resultado vem marcado como está.
      { nome: 'tipo', rotulo: 'Resultado', tipo: 'radio', valor: ladoWo, opcoes: [
        ['placar', 'Placar jogado (preencha os games)'],
        ['wo_a', `WO, vence ${arDupla(arTeam(m.team_a))}`],
        ['wo_b', `WO, vence ${arDupla(arTeam(m.team_b))}`],
      ] },
      { nome: 'ga', rotulo: arDupla(arTeam(m.team_a)), tipo: 'number', valor: m.games_a ?? '', meio: true, extra: 'min="0" max="7" inputmode="numeric"' },
      { nome: 'gb', rotulo: arDupla(arTeam(m.team_b)), tipo: 'number', valor: m.games_b ?? '', meio: true, extra: 'min="0" max="7" inputmode="numeric"' },
      { nome: 'ta', rotulo: 'Tie-break (A)', tipo: 'number', valor: m.tb_a ?? '', meio: true, extra: 'min="0" max="50" inputmode="numeric"' },
      { nome: 'tb', rotulo: 'Tie-break (B)', tipo: 'number', valor: m.tb_b ?? '', meio: true, extra: 'min="0" max="50" inputmode="numeric"' },
      { nome: 'motivo', rotulo: 'Motivo', obrigatorio: true, valor: corrigir ? '' : 'Lançado pela Mesa' },
      ...(podeForcar ? [{ nome: 'forcar', rotulo: 'Forçar (a partida seguinte já começou; ela fica marcada para revisão)', tipo: 'checkbox' }] : []),
    ],
    ok: corrigir ? 'Corrigir' : 'Lançar',
  });
  if (!v) return;
  const n = x => (x === '' ? null : Number(x));
  const wo = v.tipo !== 'placar';
  const alvo = preset === 'B' ? 4 : 6;
  // WO = alvo x 0 para quem compareceu (docs/ARENA.md, presets).
  const placar = wo
    ? { games_a: v.tipo === 'wo_a' ? alvo : 0, games_b: v.tipo === 'wo_b' ? alvo : 0, tb_a: null, tb_b: null }
    : { games_a: n(v.ga), games_b: n(v.gb), tb_a: n(v.ta), tb_b: n(v.tb) };
  if (!wo) {
    if (placar.games_a == null || placar.games_b == null) return arToast('Preencha os games das duas duplas.', 'erro');
    const r = BT8Championship.validarPlacar(placar, preset);
    if (!r.ok) return arToast(r.erro, 'erro');
  }
  mesaRpc('match_set_result', {
    p_match: id, p_games_a: placar.games_a, p_games_b: placar.games_b, p_tb_a: placar.tb_a, p_tb_b: placar.tb_b,
    p_wo: wo, p_motivo: v.motivo, p_forcar: !!v.forcar,
  }, corrigir ? 'Placar corrigido.' : 'Placar lançado.');
}

async function mesaPausar() {
  const c = ARENA.c.camp;
  if (c.pausado) {
    if (!(await arConfirm('Retomar evento', 'A faixa de pausa sai do telão e as previsões voltam a andar.', 'Retomar'))) return;
    return mesaRpc('championship_pause', { p_championship: c.id, p_motivo: null }, 'Evento retomado.');
  }
  const v = await arForm({
    titulo: 'Pausar evento', texto: 'O telão mostra "PAUSA – motivo" e as previsões ficam congeladas.',
    campos: [{ nome: 'motivo', rotulo: 'Motivo', obrigatorio: true, valor: 'Chuva' }], ok: 'Pausar', perigo: true,
  });
  if (!v) return;
  mesaRpc('championship_pause', { p_championship: c.id, p_motivo: v.motivo }, 'Evento pausado.');
}

// ══ CREDENCIAMENTO ═══════════════════════════════════════
async function credAbrir() {
  goTo('screen-arena-credenciamento');
  MESA.busca = '';
  try {
    await mesaAtualizar();
  } catch (e) {
    return arToast(e.message, 'erro');
  }
  credRender();
  mesaIniciarPolling(credLista, 'screen-arena-credenciamento');
}

const credDuplas = () => ARENA.c.teams.filter(t => arAtiva(t) && !t.desistente_em);
const credNorm = s => arSlug(s).replace(/-/g, ' ');

function credRender() {
  arScreen('screen-arena-credenciamento', 'Credenciamento', `
    <div class="ar-card mesa-cred-topo">
      <div id="cred-contador" class="cred-contador" aria-live="polite"></div>
      <label class="ar-field"><span>Buscar atleta</span>
        <input class="input-field" type="search" id="cred-busca" placeholder="Nome do atleta" value="${arEsc(MESA.busca)}" oninput="MESA.busca=this.value;credLista()" autocomplete="off"></label>
    </div>
    <div class="ar-list" id="cred-lista"></div>`);
  credLista();
}

// Só a lista e o contador são redesenhados: a busca não perde o foco.
function credLista() {
  const el = document.getElementById('cred-lista');
  if (!el) return;
  const todas = credDuplas();
  const completas = todas.filter(t => t.presente1 && t.presente2).length;
  document.getElementById('cred-contador').innerHTML = `<b>${completas}/${todas.length}</b> duplas completas`;
  const q = credNorm(MESA.busca || '');
  const lista = todas
    .filter(t => !q || credNorm(arDupla(t)).includes(q))
    .sort((a, b) => arDupla(a).localeCompare(arDupla(b), 'pt-BR'));
  el.innerHTML = lista.map(t => {
    const botao = (pos, atletaId) => {
      const pres = !!t[`presente${pos}`];
      return `<button class="cred-btn ${pres ? 'on' : ''}" aria-pressed="${pres}" onclick="credMarcar('${t.id}', ${pos})">
        ${pres ? icon('check') : ''}<span>${arEsc(ARENA.c.atl[atletaId]?.nome || '?')}</span><small>${pres ? 'Presente' : 'Ausente'}</small></button>`;
    };
    return `<div class="cred-dupla ${t.presente1 && t.presente2 ? 'completa' : ''}">
      <div class="cred-cat">${arEsc(mesaCat(t.category_id)?.nome || '')}${t.presente1 && t.presente2 ? ' · apta' : ''}</div>
      <div class="cred-par">${botao(1, t.athlete1_id)}${botao(2, t.athlete2_id)}</div>
    </div>`;
  }).join('') || '<div class="ar-vazio">Nenhum atleta encontrado.</div>';
}

async function credMarcar(teamId, pos) {
  const t = arTeam(teamId);
  const novo = !t[`presente${pos}`];
  t[`presente${pos}`] = novo; // otimista: volta se o banco recusar
  credLista();
  try {
    await arenaDb().rpc('team_checkin', { p_team: teamId, p_posicao: pos, p_presente: novo });
  } catch (e) {
    t[`presente${pos}`] = !novo;
    credLista();
    arToast(e.message, 'erro');
  }
}

// ══ SUBSTITUIÇÃO DE DUPLA (até o primeiro jogo) ══════════
async function mesaSubstituir(teamId) {
  const t = arTeam(teamId);
  const candidatas = arTeamsCat(t.category_id).filter(x => x.id !== teamId && x.status !== 'cancelada' && !arNoGrupo(x.id))
    .sort((a, b) => (a.status === 'espera' ? 0 : 1) - (b.status === 'espera' ? 0 : 1));
  if (!candidatas.length) return arToast('Nenhuma dupla fora dos grupos nesta categoria. Inscreva a substituta primeiro (ela entra na espera).', 'erro');
  const v = await arForm({
    titulo: 'Substituir dupla',
    texto: `<b>${arEsc(arDupla(t))}</b> sai e fica cancelada. A substituta entra no mesmo grupo e nos mesmos jogos. Só vale se a dupla ainda não jogou.`,
    campos: [{ nome: 'nova', rotulo: 'Entra', tipo: 'select', opcoes: candidatas.map(x => [x.id, `${arDupla(x)} (${AR_STATUS_DUPLA[x.status]})`]) }],
    ok: 'Substituir', perigo: true,
  });
  if (!v) return;
  await arAcao(async () => {
    await arenaDb().rpc('team_substitute', { p_team_antigo: teamId, p_team_novo: v.nova });
    await arenaRecarregar(arenaRenderInscritos);
  }, 'Dupla substituída.');
}

// ══ EXPORTAR / IMPRIMIR (plano B) ════════════════════════
function mesaBaixar(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// CSV com ; e BOM: abre certo no Excel em português.
function mesaCsv(linhas) {
  const cel = v => {
    let s = v == null ? '' : String(v);
    // Anti-injeção de fórmula; também faz telefone (+55...) ficar como texto, sem notação científica.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + linhas.map(l => l.map(cel).join(';')).join('\r\n');
}

async function mesaExportar() {
  const v = await arForm({
    titulo: 'Exportar ou imprimir',
    campos: [
      { nome: 'oque', rotulo: 'O que', tipo: 'radio', valor: 'json', opcoes: [
        ['json', 'Backup completo (JSON)'], ['csv_duplas', 'Inscritos (CSV)'], ['csv_jogos', 'Jogos e resultados (CSV)'],
        ['sumulas', 'Imprimir súmulas dos jogos pendentes'], ['grupos', 'Imprimir grupos (tabela em branco)'], ['chave', 'Imprimir chave em branco'],
      ] },
      { nome: 'cat', rotulo: 'Categoria (para imprimir)', tipo: 'select', valor: '', opcoes: [['', 'Todas'], ...ARENA.c.cats.map(c => [c.id, c.nome])] },
    ],
    ok: 'Continuar',
  });
  if (!v) return;
  try {
    await mesaAtualizar();
  } catch (e) {
    arToast(`Sem conexão: usando os dados já carregados. ${e.message}`, 'erro');
  }
  const { camp, cats, teams, groups, groupTeams, matches } = ARENA.c;
  const base = arSlug(camp.titulo) || 'campeonato';
  const atleta = id => ARENA.c.atl[id] || {};
  if (v.oque === 'json') {
    const dados = { exportado_em: new Date().toISOString(), arena: ARENA.arena, campeonato: camp, categorias: cats, quadras: ARENA.quadras,
      duplas: teams.map(t => ({ ...t, atleta1: atleta(t.athlete1_id), atleta2: atleta(t.athlete2_id) })), grupos: groups, group_teams: groupTeams, partidas: matches };
    return mesaBaixar(`${base}.json`, JSON.stringify(dados, null, 2), 'application/json');
  }
  if (v.oque === 'csv_duplas') {
    const linhas = [['Categoria', 'Dupla', 'Atleta 1', 'Telefone 1', 'Atleta 2', 'Telefone 2', 'Status', 'Pagamento', 'Cabeça', 'Origem', 'Presente 1', 'Presente 2', 'Desistente']];
    for (const t of teams) {
      linhas.push([mesaCat(t.category_id)?.nome, arDupla(t), atleta(t.athlete1_id).nome, atleta(t.athlete1_id).telefone, atleta(t.athlete2_id).nome, atleta(t.athlete2_id).telefone,
        t.status, t.pagamento, t.seed || '', t.origem, t.presente1 ? 'sim' : 'não', t.presente2 ? 'sim' : 'não', t.desistente_em ? 'sim' : 'não']);
    }
    return mesaBaixar(`${base}-inscritos.csv`, mesaCsv(linhas), 'text/csv;charset=utf-8');
  }
  if (v.oque === 'csv_jogos') {
    const linhas = [['Categoria', 'Fase', 'Grupo', 'Rodada', 'Dupla A', 'Dupla B', 'Games A', 'Games B', 'TB A', 'TB B', 'Vencedor', 'Status', 'Quadra', 'Encerrada em']];
    for (const m of matches) {
      linhas.push([mesaCat(m.category_id)?.nome, AR_FASE[m.fase], m.group_id ? mesaGrupo(m.group_id)?.nome : '', m.rodada, arDupla(arTeam(m.team_a)), arDupla(arTeam(m.team_b)),
        m.games_a, m.games_b, m.tb_a, m.tb_b, m.vencedor ? arDupla(arTeam(m.vencedor)) : '', AR_STATUS_JOGO[m.status] || m.status, mesaQuadra(m.court_id)?.nome || '', m.encerrada_em || '']);
    }
    return mesaBaixar(`${base}-jogos.csv`, mesaCsv(linhas), 'text/csv;charset=utf-8');
  }
  mesaImprimir(v.oque, v.cat);
}

function mesaImprimir(tipo, catId) {
  const { camp } = ARENA.c;
  const cats = ARENA.c.cats.filter(c => !catId || c.id === catId);
  const dupla = id => (id ? arEsc(arDupla(arTeam(id))) : '');
  let corpo = '';
  if (tipo === 'sumulas') {
    const pend = ARENA.c.matches.filter(m => cats.some(c => c.id === m.category_id) && !arFinal(m))
      .sort((a, b) => (a.prioridade || 0) - (b.prioridade || 0));
    const porId = Object.fromEntries(ARENA.c.matches.map(m => [m.id, m]));
    const lado = (m, l) => dupla(m[`team_${l}`]) || arEsc(arOrigemTxt(m[`origem_${l}`], porId));
    corpo = pend.map(m => `
      <section class="pr-sumula">
        <div class="pr-cab"><b>${arEsc(camp.titulo)}</b><span>${arEsc(mesaRotulo(m))}</span></div>
        <div class="pr-linha">Quadra: ________ &nbsp; Início: ____:____ &nbsp; Fim: ____:____</div>
        <table class="pr-tab"><tr><th>Dupla</th><th>Games</th><th>Tie-break</th></tr>
          <tr><td>${lado(m, 'a')}</td><td></td><td></td></tr>
          <tr><td>${lado(m, 'b')}</td><td></td><td></td></tr></table>
        <div class="pr-linha">WO / ocorrências: ____________________________________________</div>
        <div class="pr-linha">Árbitro: ______________________ &nbsp; Visto da Mesa: ______________</div>
      </section>`).join('') || '<p>Nenhum jogo pendente.</p>';
  } else if (tipo === 'grupos') {
    corpo = cats.map(c => `<h2>${arEsc(c.nome)}</h2>${arGruposCat(c.id).map(g => {
      const ids = arDuplasDoGrupo(g.id);
      return `<section class="pr-bloco"><h3>Grupo ${arEsc(g.nome)}</h3>
        <table class="pr-tab"><tr><th>Dupla</th>${ids.map((_, i) => `<th>${i + 1}</th>`).join('')}<th>V</th><th>SG</th><th>GP</th><th>Pos.</th></tr>
        ${ids.map((id, i) => `<tr><td>${i + 1}. ${dupla(id)}</td>${ids.map((_, k) => `<td class="${k === i ? 'pr-x' : ''}"></td>`).join('')}<td></td><td></td><td></td><td></td></tr>`).join('')}
        </table></section>`;
    }).join('') || '<p>Sorteio não publicado.</p>'}`).join('');
  } else {
    corpo = cats.map(c => {
      const ko = ARENA.c.matches.filter(m => m.category_id === c.id && m.fase !== 'grupo');
      const ordem = { r16: 1, qf: 2, sf: 3, final: 4 };
      ko.sort((a, b) => ordem[a.fase] - ordem[b.fase] || a.slot - b.slot);
      const porId = Object.fromEntries(ko.map(m => [m.id, m]));
      return `<h2>${arEsc(c.nome)}</h2><section class="pr-bloco"><table class="pr-tab"><tr><th>Jogo</th><th>Dupla A</th><th>Games</th><th>Dupla B</th><th>Games</th></tr>
        ${ko.map(m => `<tr><td>${arEsc(arJogoNome(m))}</td><td>${arEsc(arOrigemTxt(m.origem_a, porId))}<br>________________</td><td></td><td>${arEsc(arOrigemTxt(m.origem_b, porId))}<br>________________</td><td></td></tr>`).join('')
        || '<tr><td colspan="5">Sorteio não publicado.</td></tr>'}</table></section>`;
    }).join('');
  }
  let el = document.getElementById('ar-print');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ar-print';
    document.body.appendChild(el);
  }
  el.innerHTML = `<h1>${arEsc(camp.titulo)}</h1>${corpo}`;
  window.print();
}

// ══ DEMO: RPCs da Mesa no banco simulado (arena.js) ══════
function mesaDemoToque(m) {
  m.version = (m.version || 0) + 1;
  m.updated_at = new Date().toISOString();
}

function mesaDemoPropagar(db, m, forcar) {
  const prox = m.next_match_id && db.matches.find(x => x.id === m.next_match_id);
  if (!prox) return;
  const campo = `team_${m.next_slot}`;
  if (prox[campo] === m.vencedor) return;
  if (arFinal(prox)) throw arDemoErro(AR_HINTS.proxima_encerrada, 'proxima_encerrada');
  if (['em_jogo', 'suspensa', 'chamada'].includes(prox.status) && prox[campo]) {
    if (!forcar) throw arDemoErro(AR_HINTS.proxima_iniciada, 'proxima_iniciada');
    prox.alerta_origem = true;
  }
  prox[campo] = m.vencedor;
  mesaDemoToque(prox);
}

if (typeof AR_DEMO_RPC !== 'undefined') {
  Object.assign(AR_DEMO_RPC, {
    match_call(db, { p_match, p_court }) {
      const m = db.matches.find(x => x.id === p_match);
      if (!['agendada', 'suspensa', 'chamada'].includes(m.status)) throw arDemoErro('Esse jogo não pode ser chamado agora.', 'status_invalido');
      if (!m.team_a || !m.team_b) throw arDemoErro('O jogo ainda não tem as duas duplas.', 'status_invalido');
      Object.assign(m, { status: 'chamada', court_id: p_court, chamada_em: new Date().toISOString() });
      mesaDemoToque(m);
      return { ok: true, match: m };
    },
    match_start(db, { p_match }) {
      const m = db.matches.find(x => x.id === p_match);
      if (m.status !== 'chamada') throw arDemoErro('Só um jogo chamado pode ser iniciado.', 'status_invalido');
      Object.assign(m, { status: 'em_jogo', iniciada_em: new Date().toISOString(), games_a: m.games_a ?? 0, games_b: m.games_b ?? 0 });
      mesaDemoToque(m);
      return { ok: true, match: m };
    },
    match_suspend(db, { p_match, p_motivo }) {
      const m = db.matches.find(x => x.id === p_match);
      if (!p_motivo) throw arDemoErro('Informe o motivo.', 'motivo_obrigatorio');
      if (!mesaAtivos(m)) throw arDemoErro('Só jogos chamados ou em andamento podem ser suspensos.', 'status_invalido');
      Object.assign(m, { status: 'suspensa', court_id: null, scout_device: null });
      mesaDemoToque(m);
      return { ok: true, match: m };
    },
    match_set_result(db, { p_match, p_games_a, p_games_b, p_tb_a, p_tb_b, p_wo, p_motivo, p_forcar }) {
      const m = db.matches.find(x => x.id === p_match);
      if (!p_motivo) throw arDemoErro('Informe o motivo.', 'motivo_obrigatorio');
      if (m.group_id && db.category_groups.find(g => g.id === m.group_id)?.fechado_em) throw arDemoErro('O grupo já foi fechado: o placar não pode mais mudar.', 'grupo_fechado');
      const cat = db.categories.find(c => c.id === m.category_id);
      const f = { ...AR_FORMATO_PADRAO, ...(cat.formato || {}) };
      const placar = { games_a: p_games_a, games_b: p_games_b, tb_a: p_tb_a, tb_b: p_tb_b };
      const r = p_wo
        ? { ok: (p_games_a > 0) !== (p_games_b > 0), vencedor: p_games_a > 0 ? 'a' : 'b', erro: 'WO precisa de um vencedor.' }
        : BT8Championship.validarPlacar(placar, m.fase === 'grupo' ? f.preset_grupo : f.preset_mata);
      if (!r.ok) throw arDemoErro(r.erro, 'placar_invalido');
      const antes = { ...m };
      Object.assign(m, placar, { status: p_wo ? 'wo' : 'encerrada', wo: !!p_wo, vencedor: m[`team_${r.vencedor}`], encerrada_em: m.encerrada_em || new Date().toISOString(), court_id: null });
      try {
        mesaDemoPropagar(db, m, p_forcar);
      } catch (e) {
        Object.assign(m, antes);
        throw e;
      }
      mesaDemoToque(m);
      return { ok: true, match: m };
    },
    team_checkin(db, { p_team, p_posicao, p_presente }) {
      const t = db.teams.find(x => x.id === p_team);
      t[`presente${p_posicao}`] = !!p_presente;
      return { ok: true, team: t };
    },
    championship_pause(db, { p_championship, p_motivo }) {
      const c = db.championships.find(x => x.id === p_championship);
      Object.assign(c, { pausado: !!p_motivo, pausa_motivo: p_motivo || null, pausado_em: p_motivo ? new Date().toISOString() : null });
      return { ok: true, pausado: c.pausado };
    },
    team_substitute(db, { p_team_antigo, p_team_novo }) {
      const velho = db.teams.find(x => x.id === p_team_antigo);
      const novo = db.teams.find(x => x.id === p_team_novo);
      if (!novo || novo.category_id !== velho.category_id) throw arDemoErro('A substituta precisa ser da mesma categoria.', 'dados_invalidos');
      if (db.matches.some(m => (m.team_a === p_team_antigo || m.team_b === p_team_antigo) && ['em_jogo', 'suspensa', 'encerrada', 'wo'].includes(m.status))) {
        throw arDemoErro('A dupla já jogou: a substituição não é mais possível.', 'dupla_ja_jogou');
      }
      for (const gt of db.group_teams) if (gt.team_id === p_team_antigo) gt.team_id = p_team_novo;
      for (const m of db.matches) {
        if (m.team_a === p_team_antigo) m.team_a = p_team_novo;
        if (m.team_b === p_team_antigo) m.team_b = p_team_novo;
      }
      velho.status = 'cancelada';
      novo.status = 'confirmada';
      return { ok: true };
    },
  });
}

// Só na demo: simula o scout marcando um game no jogo em andamento.
async function mesaDemoGame(id, lado) {
  const m = arDemoDb().matches.find(x => x.id === id);
  m[`games_${lado}`] = (m[`games_${lado}`] || 0) + 1;
  mesaDemoToque(m);
  arDemoSalvar();
  await mesaRecarregar(mesaRender);
}
