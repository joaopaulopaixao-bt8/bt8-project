// Telão (/telao/<slug>). Agente A2. Entrada: openTelaoRoute(slug), tela #screen-telao.
// TV 1920x1080, sem login, só leitura: arena_live a cada 4 s, arena_public a cada 30 s (ou quando a
// estrutura muda). Quadras em grade 2x2 (com páginas acima de 4); a cada 3 páginas, 15 s de rodízio
// com a classificação de um grupo, o mata-mata em lista ou os campeões.
const TL = { slug: '', live: null, pub: null, okEm: 0, pagina: 0, ciclos: 0, rodizio: 0, modo: 'quadras', timers: [] };

function openTelaoRoute(slug) {
  TL.slug = slug;
  TL.timers.forEach(t => clearInterval(t));
  const el = document.getElementById('screen-telao');
  el.innerHTML = `<div class="tl">
    <header class="tl-top">
      <div class="tl-titulo" id="tl-titulo">BT8</div>
      <div class="tl-relogio" id="tl-relogio"></div>
      <button class="tl-tela-cheia" type="button" onclick="telaoTelaCheia()" aria-label="Tela cheia">Tela cheia</button>
    </header>
    <div class="tl-pausa" id="tl-pausa" hidden></div>
    <main class="tl-main" id="tl-main"><div class="tl-vazio">Carregando…</div></main>
    <footer class="tl-rodape" id="tl-rodape"></footer>
    <div class="tl-atualizado" id="tl-atualizado"></div>
  </div>`;
  telaoLive();
  telaoEstrutura();
  TL.timers = [
    setInterval(telaoLive, 4000),
    setInterval(telaoEstrutura, 30000),
    setInterval(telaoRelogio, 1000),
    setInterval(telaoCiclo, 5000),
  ];
  // Recarrega a cada 2 h (pega versão nova do app e limpa memória da TV).
  setTimeout(() => location.reload(), 2 * 60 * 60 * 1000);
}

async function telaoLive() {
  try {
    const r = await arenaRpc('arena_live', { p_slug: TL.slug, p_since: TL.live?.championship?.live_version ?? null });
    if (r.ok === false) return telaoMensagem('Campeonato não encontrado');
    TL.okEm = Date.now();
    if (r.changed !== false) TL.live = r;
    const ev = r.estrutura_version ?? r.championship?.estrutura_version;
    if (TL.pub && ev != null && ev !== TL.pub.championship.estrutura_version) telaoEstrutura();
    telaoRender();
  } catch (e) { /* mantém a última tela; a faixa amarela avisa depois de 30 s */ }
}

async function telaoEstrutura() {
  try {
    const r = await arenaRpc('arena_public', { p_slug: TL.slug, p_since_estrutura: TL.pub?.championship?.estrutura_version ?? null });
    if (r.ok === false) return;
    if (r.changed !== false) TL.pub = r;
    telaoRender();
  } catch (e) { /* tenta no próximo ciclo */ }
}

function telaoMensagem(msg) {
  document.getElementById('tl-main').innerHTML = `<div class="tl-vazio">${escapeHtml(msg)}</div>`;
}

function telaoTelaCheia() {
  const el = document.documentElement;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else el.requestFullscreen?.().catch(() => {});
}

function telaoRelogio() {
  const rel = document.getElementById('tl-relogio');
  if (rel) rel.textContent = arenaHora(Date.now());
  const at = document.getElementById('tl-atualizado');
  if (!at || !TL.okEm) return;
  const s = Math.round((Date.now() - TL.okEm) / 1000);
  at.textContent = `Atualizado há ${s} s`;
  at.classList.toggle('atrasado', s > 30);
  if (s > 30) at.textContent = `Sem atualização há ${s} s — verificando a conexão`;
}

// Itens do rodízio: um por grupo de cada categoria, o mata-mata publicado e os campeões.
function telaoItensRodizio() {
  if (!TL.pub) return [];
  const itens = [];
  for (const c of TL.pub.categorias || []) {
    const r = BT8Championship.resumoCategoria(TL.pub, c.id);
    if (r.campeoes) itens.push({ tipo: 'campeoes', c, r });
    if (r.mata.length && r.mata.some(p => p.team_a || p.team_b)) itens.push({ tipo: 'mata', c, r });
    r.grupos.forEach(g => itens.push({ tipo: 'grupo', c, g }));
  }
  return itens;
}

// Roda a cada 5 s: página de quadras a cada 10 s; depois de 3 páginas, 15 s de rodízio.
function telaoCiclo() {
  TL.ticks = (TL.ticks || 0) + 1;
  if (TL.modo === 'rodizio') {
    if (TL.ticks < 3) return;
    Object.assign(TL, { modo: 'quadras', ticks: 0, ciclos: 0 });
    return telaoRender();
  }
  if (TL.ticks < 2) return;
  TL.ticks = 0;
  if (++TL.ciclos >= 3 && telaoItensRodizio().length) {
    TL.modo = 'rodizio';
    TL.rodizio++;
  } else {
    TL.pagina = (TL.pagina + 1) % Math.max(1, Math.ceil(telaoQuadras().length / 4));
  }
  telaoRender();
}

function telaoQuadras() {
  return ((TL.live || TL.pub)?.quadras || []).filter(q => q.ativa !== false).sort((x, y) => x.ordem - y.ordem);
}

function telaoRender() {
  const fonte = TL.live || TL.pub;
  if (!fonte) return;
  const ch = { ...(TL.pub?.championship || {}), ...(TL.live?.championship || {}) };
  document.getElementById('tl-titulo').textContent = ch.titulo || 'BT8';
  document.title = `Telão · ${ch.titulo || 'BT8'}`;
  const pausa = document.getElementById('tl-pausa');
  pausa.hidden = !ch.pausado;
  if (ch.pausado) pausa.textContent = `PAUSA – ${String(ch.pausa_motivo || 'evento pausado').toUpperCase()}`;
  document.getElementById('tl-main').innerHTML = TL.modo === 'rodizio' ? telaoRodizio() : telaoGrade();
  document.getElementById('tl-rodape').innerHTML = telaoRodape();
}

function telaoGrade() {
  const quadras = telaoQuadras();
  if (!quadras.length) return '<div class="tl-vazio">Nenhuma quadra cadastrada</div>';
  const paginas = Math.ceil(quadras.length / 4);
  const pagina = TL.pagina % paginas;
  const partidas = TL.live?.partidas || [];
  const cards = quadras.slice(pagina * 4, pagina * 4 + 4).map(q => {
    const p = partidas.find(x => x.court_id === q.id && x.status === 'em_jogo') || partidas.find(x => x.court_id === q.id);
    if (!p) {
      return `<div class="tl-quadra livre"><div class="tl-quadra-top"><span>${escapeHtml(q.nome.toUpperCase())}</span><span class="tl-selo livre">LIVRE</span></div></div>`;
    }
    const onde = p.grupo ? `Grupo ${p.grupo}` : BT8Championship.FASE_NOME[p.fase] || '';
    const tb = p.tb_a != null || p.tb_b != null ? `<div class="tl-tb">TIE-BREAK ${p.tb_a ?? 0}-${p.tb_b ?? 0}</div>` : '';
    const selo = p.status === 'em_jogo' ? '<span class="tl-selo vivo">AO VIVO</span>' : '<span class="tl-selo chamada">CHAMADA</span>';
    return `<div class="tl-quadra ${p.status}">
      <div class="tl-quadra-top"><span>${escapeHtml(q.nome.toUpperCase())} · ${escapeHtml(p.categoria || '')} · ${escapeHtml(onde)}</span>${selo}</div>
      <div class="tl-dupla"><span class="tl-nome">${escapeHtml(p.team_a?.nome)}</span><span class="tl-games">${p.games_a ?? 0}</span></div>
      <div class="tl-dupla"><span class="tl-nome">${escapeHtml(p.team_b?.nome)}</span><span class="tl-games">${p.games_b ?? 0}</span></div>
      ${tb}
    </div>`;
  }).join('');
  const marcador = paginas > 1 ? `<div class="tl-paginas">Quadras ${pagina * 4 + 1}–${Math.min(quadras.length, pagina * 4 + 4)} de ${quadras.length}</div>` : '';
  return `<div class="tl-grade">${cards}</div>${marcador}`;
}

function telaoRodizio() {
  const itens = telaoItensRodizio();
  if (!itens.length) return telaoGrade();
  const it = itens[TL.rodizio % itens.length];
  if (it.tipo === 'campeoes') {
    const r = it.r.campeoes;
    return `<div class="tl-painel tl-campeoes">
      <div class="tl-painel-titulo">${escapeHtml(it.c.nome.toUpperCase())} · CAMPEÕES</div>
      <div class="tl-campeao">${icon('trophy')} ${escapeHtml(r.campeao)}</div>
      <div class="tl-vice">Vice: ${escapeHtml(r.vice)}</div>
      ${r.terceiros.length ? `<div class="tl-vice">3º lugar: ${r.terceiros.map(escapeHtml).join(' e ')}</div>` : ''}
    </div>`;
  }
  if (it.tipo === 'mata') {
    return `<div class="tl-painel"><div class="tl-painel-titulo">${escapeHtml(it.c.nome.toUpperCase())} · MATA-MATA</div>
      <div class="tl-lista">${it.r.mata.map(p => `<div class="tl-lista-linha">
        <span class="tl-fase">${escapeHtml(BT8Championship.FASE_NOME[p.fase])}</span>
        <span class="${p.vencedor && p.vencedor === p.team_a ? 'venc' : ''}">${escapeHtml(p.nome_a)}</span>
        <b>${escapeHtml(arenaPlacar(p)) || 'x'}</b>
        <span class="${p.vencedor && p.vencedor === p.team_b ? 'venc' : ''}">${escapeHtml(p.nome_b)}</span>
      </div>`).join('')}</div></div>`;
  }
  const g = it.g;
  return `<div class="tl-painel"><div class="tl-painel-titulo">${escapeHtml(it.c.nome.toUpperCase())} · GRUPO ${escapeHtml(g.nome)}</div>
    <table class="tl-tabela"><thead><tr><th>#</th><th>Dupla</th><th>J</th><th>V</th><th>SG</th><th>GP</th></tr></thead>
    <tbody>${g.tabela.map(l => `<tr><td>${l.pos}</td><td>${escapeHtml(l.nome || '')}</td><td>${l.jogos}</td><td>${l.vitorias}</td>
      <td>${l.saldo > 0 ? '+' : ''}${l.saldo}</td><td>${l.gp}</td></tr>`).join('')}</tbody></table></div>`;
}

function telaoRodape() {
  const partidas = TL.live?.partidas || [];
  const quadra = id => (telaoQuadras().find(q => q.id === id) || {}).nome || '';
  const chamadas = partidas.filter(p => p.status === 'chamada')
    .map(p => `<span class="tl-chamada">CHAMADA: ${escapeHtml(quadra(p.court_id))} – ${escapeHtml(p.team_a?.nome)} x ${escapeHtml(p.team_b?.nome)}</span>`);
  let proximos = [];
  if (TL.pub) {
    const nome = id => (TL.pub.duplas.find(d => d.id === id) || {}).nome || '';
    const fila = BT8Championship.ordenarFila(TL.pub.partidas.filter(p => p.team_a && p.team_b && !partidas.some(x => x.id === p.id)));
    proximos = fila.slice(0, 4).map(p => `<span>${escapeHtml(nome(p.team_a))} x ${escapeHtml(nome(p.team_b))}</span>`);
  }
  return `${chamadas.join('')}${proximos.length ? `<span class="tl-prox-rotulo">PRÓXIMOS:</span>${proximos.join('<span class="tl-sep">·</span>')}` : ''}`;
}
