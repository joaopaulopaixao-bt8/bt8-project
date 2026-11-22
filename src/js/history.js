// ══════════════════════════════════════════════════
// HISTÓRICO DE TORNEIOS
// ══════════════════════════════════════════════════

// ── TORNEIO PENDENTE DE SALVAR ───────────────────────────
// O torneio em andamento fica no aparelho (saveActiveTournament). Se terminou e ainda não
// foi gravado no histórico (visitante, sem conexão, erro ou limite do Free), continua lá
// como "pendente" e é salvo assim que der: login/cadastro, retorno do checkout, conexão
// voltando, app voltando para a tela ou abrindo de novo.
// Dono: `state.ownerId` é o id de quem criou/mexeu logado (null = visitante). Só o dono
// (ou qualquer conta, para torneio de visitante) salva; no logout o snapshot do dono é apagado.
let SAVE_IN_FLIGHT = null;
let PENDING_SAVE_REASON = null;   // 'guest' | 'error' | 'limit' | 'missing' | null
let PENDING_SAVE_READY = false;   // só depois de saber se há usuário logado
const PENDING_NOTICE_CLOSED_KEY = 'bt8_pending_notice_closed';

function logSaveError(stage, e, extra) {
  console.error('[bt8] tournament_save_failed', {
    stage, code: e?.code || null, message: e?.message || String(e), ...(extra || {})
  });
}

function isMyTournament(state) {
  return !state.ownerId || state.ownerId === (SUPA_USER?.id || null);
}

// Snapshot antigo (antes do _savedTournamentId) que já foi salvo: não pode gerar outro insert.
function isLegacySaved(state) {
  return !!state._savedCurrentTournament && !state._savedTournamentId;
}

// Snapshot do aparelho, deste usuário, que terminou e ainda não está no histórico
// (ou tem correção não gravada).
function pendingTournament() {
  const data = typeof readActiveTournament === 'function' ? readActiveTournament() : null;
  const st = data?.state;
  if (!st || !isTournamentComplete(st.matches) || !isMyTournament(st)) return null;
  if (isLegacySaved(st)) return null;
  // Snapshots antigos não têm _pendingSave: pendente se nunca foi salvo.
  return (st._pendingSave ?? !st._savedCurrentTournament) ? data : null;
}

// Calcula algo com o APP temporariamente apontando para outro torneio (ex.: ranking do snapshot).
function withTournamentState(state, fn) {
  const keys = ['mode', 'category', 'fmt', 'players', 'matches', 'rounds', '_hasBye', 'idaVolta'];
  const backup = {};
  keys.forEach(k => { backup[k] = APP[k]; APP[k] = state[k]; });
  try { return fn(); } finally { keys.forEach(k => { APP[k] = backup[k]; }); }
}

function patchActiveTournament(uid, patch) {
  const cur = readActiveTournament();
  if (!cur || cur.state.tourneyUid !== uid) return null;
  Object.assign(cur.state, patch);
  writeActiveTournament(cur);
  if (APP.tourneyUid === uid) Object.assign(APP, patch);
  return cur;
}

function markTournamentSaved(savedState, id) {
  const cur = readActiveTournament();
  if (!cur || cur.state.tourneyUid !== savedState.tourneyUid) return;
  // Se o placar mudou enquanto gravava, continua pendente para o próximo salvamento.
  const unchanged = JSON.stringify(cur.state.matches) === JSON.stringify(savedState.matches);
  const patch = { _savedTournamentId: id, _savedCurrentTournament: true, ownerId: SUPA_USER.id };
  if (unchanged) patch._pendingSave = false;
  patchActiveTournament(savedState.tourneyUid, patch);
}

// Grava o torneio atual: chamado ao abrir o resultado final.
async function saveTournament() {
  saveActiveTournament();
  return savePendingTournament({ fromUser: true });
}

function savePendingTournament(opts = {}) {
  if (SAVE_IN_FLIGHT) return SAVE_IN_FLIGHT.then(() => savePendingTournament(opts));
  SAVE_IN_FLIGHT = doSavePendingTournament(opts).finally(() => {
    SAVE_IN_FLIGHT = null;
    renderPendingSaveNotice();
  });
  return SAVE_IN_FLIGHT;
}

// Coluna client_uid ainda não existe no banco (migração 002 não aplicada): usa o insert simples.
function isMissingClientUid(error) {
  return ['PGRST204', '42703', '42P10'].includes(error?.code) || /client_uid/.test(error?.message || '');
}

function isFreeLimitError(error) {
  return error?.hint === 'free_limit_reached';
}

async function doSavePendingTournament(opts) {
  const data = pendingTournament();
  if (!data) { PENDING_SAVE_REASON = null; return true; }
  if (!SUPA || !SUPA_USER) { PENDING_SAVE_REASON = 'guest'; return false; }
  const st = data.state;
  // Usuário logado tentou salvar: o torneio passa a ser dele (mesmo que falhe), para o logout apagá-lo.
  if (!st.ownerId) { st.ownerId = SUPA_USER.id; patchActiveTournament(st.tourneyUid, { ownerId: st.ownerId }); }
  // Registro salvo sumiu da conta: só tenta de novo quando o usuário escolher "Salvar como novo".
  if (st._saveMissing) { PENDING_SAVE_REASON = 'missing'; return false; }
  let stage = 'prepare';
  try {
    const standings = withTournamentState(st, getStandings);
    const row = {
      mode: st.mode,
      category: st.category,
      players: st.players,
      standings,
      state: {
        mode: st.mode, category: st.category, fmt: st.fmt,
        players: st.players, rounds: st.rounds || [], matches: st.matches
      }
    };
    let id = st._savedTournamentId || null;
    if (id) {
      // Correção de placar: atualiza o mesmo registro em vez de inserir outro.
      stage = 'update';
      const { data: rows, error } = await SUPA.from('tournaments').update(row).eq('id', id).select('id');
      if (error) throw error;
      // 0 linhas: registro apagado ou de outra conta (RLS). Nunca vira insert de cópia.
      if (!rows?.length) {
        PENDING_SAVE_REASON = 'missing';
        patchActiveTournament(st.tourneyUid, { _saveMissing: true });
        logSaveError('update_not_found', { message: 'nenhuma linha atualizada' }, { mode: st.mode, id });
        return false;
      }
    } else {
      const title = MODE_INFO[st.mode].label + ' · ' + new Date(data.savedAt || Date.now()).toLocaleDateString('pt-BR');
      const payload = { user_id: SUPA_USER.id, title, ...row };
      // Tentativas automáticas só mostram o aviso fixo, sem abrir modal por cima de outra tela.
      const limitReached = info => {
        PENDING_SAVE_REASON = 'limit';
        if (opts.fromUser) showFreeLimitReached(info);
        return false;
      };
      let res = null;
      if (st.tourneyUid) {
        // Upsert primeiro: se a resposta de um salvamento anterior se perdeu, o banco não conta
        // o mesmo torneio como novo (o limite do Free é checado no banco só para torneio novo).
        stage = 'upsert';
        res = await SUPA.from('tournaments')
          .upsert({ ...payload, client_uid: st.tourneyUid }, { onConflict: 'user_id,client_uid' })
          .select('id')
          .single();
        if (isFreeLimitError(res.error)) return limitReached({});
        if (isMissingClientUid(res.error)) res = null; // banco sem a migração 002
      }
      if (!res) {
        stage = 'limit';
        const limitInfo = await validateFreeSaveLimit();
        if (!limitInfo.allowed) return limitReached(limitInfo);
        stage = 'insert';
        res = await SUPA.from('tournaments').insert(payload).select('id').single();
      }
      if (res.error) throw res.error;
      id = res.data.id;
      const access = typeof currentAccess === 'function' ? currentAccess() : null;
      trackEvent(access?.isPro ? 'pro_tournament_saved' : 'free_tournament_saved', {
        format: st.mode || '',
        category: st.category || '',
        players: (st.players || []).length
      });
    }
    markTournamentSaved(st, id);
    PENDING_SAVE_REASON = null;
    loadHomeHistory();
    return true;
  } catch (e) {
    PENDING_SAVE_REASON = 'error';
    logSaveError(stage, e, { mode: st.mode, online: navigator.onLine });
    return false;
  }
}

function retryPendingSave() {
  PENDING_SAVE_READY = true;
  if (pendingTournament()) savePendingTournament();
  else { PENDING_SAVE_REASON = null; renderPendingSaveNotice(); }
}

// "Salvar como novo": o registro antigo não existe mais nesta conta; grava outro.
function saveMissingAsNew() {
  const data = pendingTournament();
  if (!data) return;
  patchActiveTournament(data.state.tourneyUid,
    { _saveMissing: false, _savedTournamentId: null, _savedCurrentTournament: false, _pendingSave: true });
  savePendingTournament({ fromUser: true });
}

function closedNoticeKey() {
  try { return sessionStorage.getItem(PENDING_NOTICE_CLOSED_KEY); } catch (e) { return null; }
}

function closePendingSaveNotice() {
  const data = pendingTournament();
  try { sessionStorage.setItem(PENDING_NOTICE_CLOSED_KEY, `${data?.state.tourneyUid}:${PENDING_SAVE_REASON}`); } catch (e) {}
  document.getElementById('pending-save-banner')?.remove();
}

function viewPendingResult() {
  document.getElementById('pending-save-banner')?.remove();
  if (resumeActiveTournament()) verResultadoFinal(false);
}

function discardPendingTournament() {
  if (!confirm('Descartar este torneio? Ele não foi salvo no histórico e será apagado deste aparelho.')) return;
  const data = pendingTournament();
  if (data && APP.tourneyUid === data.state.tourneyUid) _doNewTourney();
  else clearActiveTournament();
  PENDING_SAVE_REASON = null;
  renderPendingSaveNotice();
}

function renderPendingSaveNotice() {
  const old = document.getElementById('pending-save-banner');
  const data = pendingTournament();
  const reason = data ? PENDING_SAVE_REASON : null;
  const hidden = !PENDING_SAVE_READY || !reason
    || closedNoticeKey() === `${data.state.tourneyUid}:${reason}`
    || (typeof isAdminRoute === 'function' && isAdminRoute());
  if (hidden) { old?.remove(); return; }
  const label = escapeHtml(MODE_INFO[data.state.mode]?.label || 'Torneio');
  const msg = {
    guest: [`<b>${label} terminado e não salvo.</b> Crie uma conta grátis para guardar no histórico.`, 'Criar conta', "openAuthModal('signup')"],
    error: [`<b>${label} ainda não foi salvo.</b> Vamos tentar de novo quando a conexão voltar.`, 'Tentar agora', 'savePendingTournament({fromUser:true})'],
    limit: [`<b>${label} não foi salvo:</b> limite do plano Free atingido. Com o Pro ele é salvo na hora.`, 'Ver Pro', 'openPlansModal()'],
    missing: [`<b>${label}:</b> o torneio salvo não foi encontrado na sua conta, então a correção não foi gravada.`, 'Salvar como novo', 'saveMissingAsNew()']
  }[reason];
  const el = old || document.createElement('div');
  el.id = 'pending-save-banner';
  el.className = 'pending-save-banner';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="psb-icon">${icon('alert')}</span>
    <span class="psb-text">${msg[0]}</span>
    <button type="button" class="psb-close" aria-label="Fechar aviso" onclick="closePendingSaveNotice()">×</button>
    <span class="psb-actions">
      <button type="button" onclick="${msg[2]}">${msg[1]}</button>
      <button type="button" class="psb-secondary" onclick="viewPendingResult()">Ver resultado</button>
      <button type="button" class="psb-secondary" onclick="discardPendingTournament()">Descartar</button>
    </span>`;
  if (!old) document.body.appendChild(el);
}

window.addEventListener('online', () => { if (PENDING_SAVE_READY) retryPendingSave(); });
document.addEventListener('visibilitychange', () => {
  if (PENDING_SAVE_READY && document.visibilityState === 'visible') retryPendingSave();
});

async function loadHomeHistory() {
  if (APP.isGuest && !SUPA_USER) {
    renderGuestHistoryPreview();
    return;
  }
  if (!SUPA || !SUPA_USER) return;
  try {
    const { data, error } = await SUPA.from('tournaments')
      .select('id,title,mode,created_at,players')
      .eq('user_id', SUPA_USER.id)
      .order('created_at', { ascending:false })
      .limit(5);
    if (error) throw error;
    renderHomeHistory(data || []);
  } catch(e) { console.error('[bt8] history_load_failed', { message: e?.message || String(e) }); }
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
  const modeIcons = { s4:'ball',s6:'ball',s8:'ball',s8x:'plus',s12:'ball',mista:'users',df:'users',dm:'users',da:'dices' };
  const rows = items.map(t => {
    const date = new Date(t.created_at).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'});
    const np = Array.isArray(t.players) ? t.players.length : '?';
    const modeIcon = icon(modeIcons[t.mode] || 'trophy');
    return `<div class="home-hist-item" onclick="openTournament('${t.id}')">
      <span class="home-hist-icon">${modeIcon}</span>
      <div class="home-hist-info">
        <div class="home-hist-title">${escapeHtml(t.title)}</div>
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
    const modeIcons = { s4:'ball',s6:'ball',s8:'ball',s8x:'plus',s12:'ball',mista:'users',df:'users',dm:'users',da:'dices' };
    el.innerHTML = data.map(t => {
      const date = new Date(t.created_at).toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'});
      const np = Array.isArray(t.players) ? t.players.length : '?';
      const modeIcon = icon(modeIcons[t.mode] || 'trophy');
      return `<div class="home-hist-item" onclick="openTournament('${t.id}')">
        <span class="home-hist-icon">${modeIcon}</span>
        <div class="home-hist-info">
          <div class="home-hist-title">${escapeHtml(t.title)}</div>
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
        const top3 = stand.slice(0,3);
    const podiumOrder = [1,0,2];
    let podiumHTML = '<div class="podium-row">';
    podiumOrder.forEach(idx => {
      const p = top3[idx]; if(!p) return;
      podiumHTML += `<div class="podium-item">
        <div class="podium-place">${idx+1}º</div>
        <div class="podium-bar p${idx+1}"><span class="podium-medal">${idx===0?icon('trophy'):''}</span></div>
        <div class="podium-name">${escapeHtml(p.name)}</div>
        <div class="podium-pts">${p.scoreLabel||''}</div>
      </div>`;
    });
    podiumHTML += '</div>';
    // Tabela ranking
    const rows = stand.map((p,i) => `<tr class="${i<3?'r'+(i+1):''}">
      <td class="rn">${i+1}º</td>
      <td style="font-weight:500">${escapeHtml(p.name)}</td>
      <td>${p.j||0}</td><td>${p.v||0}</td>
      <td><span class="pts-chip">${p.scoreLabel||0}</span></td><td></td>
    </tr>`).join('');
    // Rodadas
    let roundsHTML = '';
    const state = data.state || {};
    const matches = state.matches || [];
    if (matches.length) {
      const byRound = {};
      const phaseLabel = { rr:'Round Robin', round:'Rodadas', final:'Final', elim:'Eliminatória' };
      matches.forEach(m => {
        // Folga (__BYE__) não é jogo: não aparece no replay.
        if (m.isBye || m.a==='__BYE__' || m.b==='__BYE__') return;
        // roundNum (rotativos/duplas) e round (eliminatória) já são 1-based.
        const rn = m.roundNum!=null ? m.roundNum : (m.round!=null ? m.round : null);
        const r = m.phase==='final' ? 'Final' : rn!=null ? `Rodada ${rn}` : (phaseLabel[m.phase]||'Partidas');
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
          const score = (sA!=null||sB!=null) ? `${sA??'-'} × ${sB??'-'}` : (m.winner?`${icon('award')} ${escapeHtml(m.winner)}`:'—');
          roundsHTML += `<div class="replay-match">
            <div class="replay-match-names">${escapeHtml(nameA)} <span style="color:var(--muted)">vs</span> ${escapeHtml(nameB)}</div>
            <div class="replay-match-score">${score}</div>
          </div>`;
        });
      });
    }
    content.innerHTML = `
      <div class="podium-wrap">
        <div class="podium-sub">${escapeHtml(data.title)}</div>
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
