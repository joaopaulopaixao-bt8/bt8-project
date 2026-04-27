// ══════════════════════════════════════════════════
// HISTÓRICO DE TORNEIOS
// ══════════════════════════════════════════════════

async function saveTournament() {
  if (!SUPA || !SUPA_USER || !APP.mode) return;
  try {
    const standings = getStandings();
    const title = MODE_INFO[APP.mode].label + ' · ' + new Date().toLocaleDateString('pt-BR');
    await SUPA.from('tournaments').insert({
      user_id:  SUPA_USER.id,
      mode:     APP.mode,
      category: APP.category,
      title,
      players:  APP.players,
      standings,
      state: {
        mode: APP.mode, category: APP.category, fmt: APP.fmt,
        players: APP.players, rounds: APP.rounds||[], matches: APP.matches
      }
    });
    // Atualiza histórico na home silenciosamente
    loadHomeHistory();
  } catch(e) { /* silencioso */ }
}

async function loadHomeHistory() {
  if (APP.isGuest && !SUPA_USER) {
    renderGuestHistoryPreview();
    return;
  }
  if (!SUPA || !SUPA_USER) return;
  try {
    const { data } = await SUPA.from('tournaments')
      .select('id,title,mode,created_at,players')
      .eq('user_id', SUPA_USER.id)
      .order('created_at', { ascending:false })
      .limit(5);
    renderHomeHistory(data || []);
  } catch(e) { /* silencioso */ }
}

function renderHomeHistory(items) {
  const el = document.getElementById('home-history');
  if (!el) return;
  if (!items.length) {
    el.innerHTML = `<div class="home-hist-section home-hist-empty">
      <div class="home-hist-header">
        <span class="home-hist-label">Seu histórico</span>
      </div>
      <div class="home-hist-note">Quando você criar torneios com esta conta, eles aparecem aqui para continuar, consultar rankings e recuperar resultados.</div>
    </div>`;
    el.style.display = '';
    return;
  }
  const modeIcons = { s4:'🎾',s6:'🎾',s8:'🎾',s8x:'➕',s12:'🎾',mista:'⚥',df:'👥',dm:'👫',da:'🎲' };
  const rows = items.map(t => {
    const date = new Date(t.created_at).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'});
    const np = Array.isArray(t.players) ? t.players.length : '?';
    const icon = modeIcons[t.mode] || '🏆';
    return `<div class="home-hist-item" onclick="openTournament('${t.id}')">
      <span class="home-hist-icon">${icon}</span>
      <div class="home-hist-info">
        <div class="home-hist-title">${t.title}</div>
        <div class="home-hist-meta">${date} · ${np} jogadores</div>
      </div>
      <span class="home-hist-arrow">›</span>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="home-hist-section">
    <div class="home-hist-header">
      <span class="home-hist-label">Torneios recentes</span>
      <button class="home-hist-see-all" onclick="openHistorico()">Ver todos</button>
    </div>
    ${rows}
  </div>`;
  el.style.display = '';
}

function updateGuestConversionUI() {
  const nudge = document.getElementById('guest-save-nudge');
  const isGuest = !!(APP && APP.isGuest && !SUPA_USER);
  if (nudge) nudge.style.display = isGuest ? 'flex' : 'none';
  if (!isGuest) {
    const el = document.getElementById('home-history');
    if (el && el.dataset.guestPreview === '1') {
      el.dataset.guestPreview = '';
      el.innerHTML = '';
      el.style.display = 'none';
    }
  }
}

function renderGuestHistoryPreview() {
  const el = document.getElementById('home-history');
  if (!el) return;
  el.dataset.guestPreview = '1';
  el.innerHTML = `<div class="home-hist-section home-hist-preview">
    <div class="home-hist-header">
      <span class="home-hist-label">Seu histórico fica aqui</span>
      <button class="home-hist-see-all" onclick="openAuthModal('signup')">Criar conta grátis</button>
    </div>
    <div class="home-hist-note">Você pode testar sem cadastro. Criando uma conta, seus torneios ficam salvos para voltar depois, acompanhar rankings e consultar partidas antigas.</div>
    <div class="home-hist-item home-hist-ghost">
      <span class="home-hist-icon">01</span>
      <div class="home-hist-info">
        <div class="home-hist-title">Torneio de sábado</div>
        <div class="home-hist-meta">Ranking, partidas e placares salvos</div>
      </div>
      <span class="home-hist-arrow">salvo</span>
    </div>
    <div class="home-hist-item home-hist-ghost">
      <span class="home-hist-icon">02</span>
      <div class="home-hist-info">
        <div class="home-hist-title">Duplas da arena</div>
        <div class="home-hist-meta">Continue de onde parou no celular</div>
      </div>
      <span class="home-hist-arrow">histórico</span>
    </div>
  </div>`;
  el.style.display = '';
}

async function openHistorico() {
  if (!SUPA || !SUPA_USER) return;
  goTo('screen-historico');
  const el = document.getElementById('historico-content');
  if (el) el.innerHTML = '<div class="hist-empty">Carregando...</div>';
  try {
    const { data } = await SUPA.from('tournaments')
      .select('id,title,mode,created_at,players')
      .eq('user_id', SUPA_USER.id)
      .order('created_at', { ascending:false })
      .limit(50);
    if (!data||!data.length) { el.innerHTML='<div class="hist-empty">Nenhum torneio salvo ainda.</div>'; return; }
    const modeIcons = { s4:'🎾',s6:'🎾',s8:'🎾',s8x:'➕',s12:'🎾',mista:'⚥',df:'👥',dm:'👫',da:'🎲' };
    el.innerHTML = data.map(t => {
      const date = new Date(t.created_at).toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'});
      const np = Array.isArray(t.players) ? t.players.length : '?';
      const icon = modeIcons[t.mode] || '🏆';
      return `<div class="home-hist-item" onclick="openTournament('${t.id}')">
        <span class="home-hist-icon">${icon}</span>
        <div class="home-hist-info">
          <div class="home-hist-title">${t.title}</div>
          <div class="home-hist-meta">${date} · ${np} jogadores</div>
        </div>
        <span class="home-hist-arrow">›</span>
      </div>`;
    }).join('');
  } catch(e) { el.innerHTML='<div class="hist-empty">Erro ao carregar histórico.</div>'; }
}

async function openTournament(id) {
  if (!SUPA) return;
  goTo('screen-replay');
  const content = document.getElementById('replay-content');
  const actions = document.getElementById('replay-actions');
  if (content) content.innerHTML = '<div class="hist-empty">Carregando...</div>';
  try {
    const { data, error } = await SUPA.from('tournaments')
      .select('*').eq('id', id).single();
    if (error||!data) throw new Error('not found');
    // Atualiza título
    const titleEl = document.getElementById('replay-title');
    if (titleEl) titleEl.textContent = data.title;
    // Renderiza pódio + ranking
    const stand = data.standings || [];
    const medals = ['🥇','🥈','🥉'];
    const top3 = stand.slice(0,3);
    const podiumOrder = [1,0,2];
    let podiumHTML = '<div class="podium-row">';
    podiumOrder.forEach(idx => {
      const p = top3[idx]; if(!p) return;
      podiumHTML += `<div class="podium-item">
        <div class="podium-place">${medals[idx]||idx+1+'º'}</div>
        <div class="podium-bar p${idx+1}"><span class="podium-medal">${medals[idx]||'🏅'}</span></div>
        <div class="podium-name">${p.name}</div>
        <div class="podium-pts">${p.scoreLabel||''}</div>
      </div>`;
    });
    podiumHTML += '</div>';
    // Tabela ranking
    const rows = stand.map((p,i) => `<tr class="${i<3?'r'+(i+1):''}">
      <td class="rn">${medals[i]||i+1+'º'}</td>
      <td style="font-weight:500">${p.name}</td>
      <td>${p.j||0}</td><td>${p.v||0}</td>
      <td><span class="pts-chip">${p.scoreLabel||0}</span></td><td></td>
    </tr>`).join('');
    // Rodadas
    let roundsHTML = '';
    const state = data.state || {};
    const matches = state.matches || [];
    if (matches.length) {
      const byRound = {};
      matches.forEach(m => {
        const rn = m.roundNum!=null ? m.roundNum : (m.round!=null ? m.round : null);
        const r = rn!=null ? `Rodada ${rn+1}` : (m.phase==='elim'?'Eliminatória':(m.phase||'Partidas'));
        if (!byRound[r]) byRound[r] = [];
        byRound[r].push(m);
      });
      roundsHTML = '<div class="replay-rounds-title">Rodadas</div>';
      Object.entries(byRound).forEach(([label, ms]) => {
        roundsHTML += `<div class="replay-round-label">${label}</div>`;
        ms.forEach(m => {
          const nameA = m.a||m.teamA||m.p1Name||m.p1||'?';
          const nameB = m.b||m.teamB||m.p2Name||m.p2||'?';
          const sA = m.sA!=null?m.sA:(m.s1!=null?m.s1:null);
          const sB = m.sB!=null?m.sB:(m.s2!=null?m.s2:null);
          const score = (sA!=null||sB!=null) ? `${sA??'-'} × ${sB??'-'}` : (m.winner?`▶ ${m.winner}`:'—');
          roundsHTML += `<div class="replay-match">
            <div class="replay-match-names">${nameA} <span style="color:var(--muted)">vs</span> ${nameB}</div>
            <div class="replay-match-score">${score}</div>
          </div>`;
        });
      });
    }
    content.innerHTML = `
      <div class="podium-wrap">
        <div class="podium-sub">${data.title}</div>
      </div>
      ${podiumHTML}
      <div class="accent-line"></div>
      <table class="full-rank-table">
        <thead><tr><th>#</th><th>Nome</th><th>J</th><th>V</th><th>Pts</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${roundsHTML}
    `;
    // Botão compartilhar: restaura estado e gera canvas
    if (actions) actions.innerHTML = `
      <div style="display:flex;gap:8px">
        <button class="share-btn-save" onclick="replayShare('${id}')" style="flex:1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Compartilhar Ranking
        </button>
      </div>`;
    // Guarda state para o share
    window._replayState = data.state;
  } catch(e) { content.innerHTML='<div class="hist-empty">Erro ao carregar torneio.</div>'; }
}

async function replayShare(id) {
  if (!window._replayState) return;
  const s = window._replayState;
  // Restaura o APP state temporariamente para gerar o canvas
  const backup = { mode:APP.mode, category:APP.category, fmt:APP.fmt, players:APP.players, matches:APP.matches, rounds:APP.rounds };
  APP.mode=s.mode; APP.category=s.category; APP.fmt=s.fmt;
  APP.players=s.players; APP.matches=s.matches||[]; APP.rounds=s.rounds||[];
  try {
    await generateShareCanvas();
    await nativeShare();
  } finally {
    APP.mode=backup.mode; APP.category=backup.category; APP.fmt=backup.fmt;
    APP.players=backup.players; APP.matches=backup.matches; APP.rounds=backup.rounds;
  }
}
