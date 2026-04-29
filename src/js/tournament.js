// ── SCREEN 1 → 2: CATEGORY ─────────────────────────────
function selectCategory(cat) {
  APP.category = cat;
  const title = document.getElementById('tipo-title');
  const list = document.getElementById('type-list');
  title.textContent = cat === 'individual' ? 'Individual — Duplas Rotativas' : 'Duplas — Fixas ou Aleatórias';

  const items = cat === 'individual'
    ? ['s4','s6','s8','s8x','s12','mista']
    : ['df','dm','da'];

  list.innerHTML = items.map(m => {
    const info = MODE_INFO[m];
    return `<div class="type-item" onclick="selectMode('${m}')">
      <span class="type-icon">${info.icon}</span>
      <div class="type-info">
        <div class="type-name">${info.label}</div>
        <div class="type-tag">${info.stats.slice(0,2).join(' · ')}</div>
      </div>
      <span class="type-arrow">›</span>
    </div>`;
  }).join('');

  goTo('screen-tipo');
}

// ── SCREEN 2 → 3: MODE ─────────────────────────────────
function selectMode(mode) {
  APP.mode = mode;
  APP.players = [];
  APP.fmt = IS_DUPLA_FIXA[mode] ? 'rr' : 'rr';
  APP.idaVolta = false;

  const info = MODE_INFO[mode];
  document.getElementById('config-title').textContent = info.label;

  renderConfigScreen();
  goTo('screen-config');
}

function renderConfigScreen() {
  const m = APP.mode;
  const info = MODE_INFO[m];
  const isDupla = IS_DUPLA_FIXA[m];
  const isAleatorio = IS_ALEATORIO[m];
  const isMistaDupla = IS_MISTA_DUPLA[m];
  const isMista = m === 'mista';
  const isSoma = IS_SOMA[m];
  const max = (isDupla && !isAleatorio) ? 999 : isAleatorio ? 999 : (MAX_PLAYERS[m] || 12);

  // Formato options
  let fmtOptions = '';
  if(!isDupla) {
    fmtOptions = `
    <div class="section-label">Formato</div>
    <div class="fmt-row">
      <div class="fmt-opt ${APP.fmt==='rr'?'active':''}" onclick="setFmt('rr',this)">
        <div class="fmt-opt-name">Round Robin 🏅</div>
        <div class="fmt-opt-desc">Ranking por vitórias</div>
      </div>
      <div class="fmt-opt ${APP.fmt==='final'?'active':''}" onclick="setFmt('final',this)">
        <div class="fmt-opt-name">+ Final</div>
        <div class="fmt-opt-desc">Top 2 na final</div>
      </div>
    </div>`;
  } else {
    fmtOptions = `
    <div class="section-label">Formato</div>
    <div class="fmt-row">
      <div class="fmt-opt ${APP.fmt==='rr'?'active':''}" onclick="setFmt('rr',this)">
        <div class="fmt-opt-name">Round Robin 🏅</div>
        <div class="fmt-opt-desc">Ranking por vitórias</div>
      </div>
      <div class="fmt-opt ${APP.fmt==='semi'?'active':''}" onclick="setFmt('semi',this)">
        <div class="fmt-opt-name">+ Semis/Final</div>
        <div class="fmt-opt-desc">Top 4 → Semis → Final</div>
      </div>
    </div>
    <div class="fmt-row" style="margin-top:6px">
      <div class="fmt-opt ${!APP.idaVolta?'active':''}" onclick="setIdaVolta(false,this)">
        <div class="fmt-opt-name">Jogo Simples</div>
        <div class="fmt-opt-desc">Cada par joga 1x</div>
      </div>
      <div class="fmt-opt ${APP.idaVolta?'active':''}" onclick="setIdaVolta(true,this)">
        <div class="fmt-opt-name">Ida e Volta 🔁</div>
        <div class="fmt-opt-desc">Cada par joga 2x</div>
      </div>
    </div>`;
  }

  // Input players
  let playerInput = '';
  if(isAleatorio) {
    // Duplas Aleatórias: cadastro individual
    const n = APP.players.length;
    const nDuplas = Math.floor(n/2);
    const parStr = n>=6 ? (n%2===0
      ? `<span style="color:#4ade80">✓ ${n} jogadores → ${nDuplas} duplas → Round Robin</span>`
      : `<span style="color:var(--yellow)">⚠ ${n} jogadores. Adicione mais 1 participante para fechar as duplas.</span>`)
      : `<span style="color:var(--muted2)">Mínimo 6 jogadores (3 duplas)</span>`;
    playerInput = `
    <div class="section-label">Jogadores <span style="color:var(--yellow)">${n}</span></div>
    <div style="font-size:11px;color:var(--muted2);margin-bottom:8px;line-height:1.5">
      Duplas sorteadas automaticamente. ${parStr}
    </div>
    <div class="input-row">
      <input class="input-field" id="inp-name" placeholder="Nome do jogador..." maxlength="28" onkeydown="if(event.key==='Enter')addPlayerOrDupla()">
    </div>
    <button class="btn btn-primary btn-full" onclick="addPlayerOrDupla()" style="margin-bottom:10px">+ Adicionar</button>`;
  } else if(isMistaDupla) {
    // Duplas Mistas: cadastro par com gênero obrigatório
    const nD = APP.players.length;
    playerInput = `
    <div class="section-label">Duplas Mistas <span style="color:var(--yellow)">${nD} dupla${nD!==1?'s':''}</span></div>
    <div style="font-size:11px;color:var(--muted2);margin-bottom:8px;line-height:1.5">
      Cada dupla: 1 Homem + 1 Mulher. Mínimo 3 duplas.
      ${nD>=3?(nD%2===1?'<span style="color:var(--yellow)">⚡ Ímpar → uma dupla descansa por rodada (bye)</span>':'<span style="color:#4ade80">✓ Par de duplas → sem byes</span>'):''}
    </div>
    <div class="input-row" style="gap:6px">
      <input class="input-field half" id="inp-p1" placeholder="Homem..." maxlength="22" onkeydown="if(event.key==='Enter')addPlayerOrDupla()">
      <input class="input-field half" id="inp-p2" placeholder="Mulher..." maxlength="22" onkeydown="if(event.key==='Enter')addPlayerOrDupla()">
    </div>
    <button class="btn btn-primary btn-full" onclick="addPlayerOrDupla()" style="margin-bottom:10px">+ Adicionar Dupla</button>`;
  } else if(isDupla) {
    // Duplas Fixas: cadastro manual de pares
    const nD = APP.players.length;
    playerInput = `
    <div class="section-label">Duplas <span style="color:var(--yellow)">${nD} dupla${nD!==1?'s':''}</span></div>
    <div style="font-size:11px;color:var(--muted2);margin-bottom:8px;line-height:1.5">
      Mínimo 3 duplas.
      ${nD>=3?(nD%2===1?'<span style="color:var(--yellow)">⚡ Ímpar → uma dupla descansa por rodada (bye)</span>':'<span style="color:#4ade80">✓ Par de duplas → sem byes</span>'):''}
    </div>
    <div class="input-row">
      <input class="input-field half" id="inp-p1" placeholder="Jogador 1..." maxlength="22" onkeydown="if(event.key==='Enter')addPlayerOrDupla()">
      <input class="input-field half" id="inp-p2" placeholder="Jogador 2..." maxlength="22" onkeydown="if(event.key==='Enter')addPlayerOrDupla()">
    </div>
    <button class="btn btn-primary btn-full" onclick="addPlayerOrDupla()" style="margin-bottom:10px">+ Adicionar Dupla</button>`;
    // (bloco antigo removido — era para d4/d6/d8)
  } else if(isMista) {
    // Super Mista dinâmica: cadastro individual H/M sem limite fixo
    const nH = APP.players.filter(p=>p.gender==='M').length;
    const nF = APP.players.filter(p=>p.gender==='F').length;
    const nDuplas = Math.min(nH, nF);
    const equilibrio = nH === nF;
    let statusStr = '';
    if(nH===0&&nF===0) statusStr = '<span style="color:var(--muted2)">Mínimo 2H + 2M</span>';
    else if(!equilibrio) statusStr = `<span style="color:var(--yellow)">⚠️ ${nH}H + ${nF}F — precisa ser igual</span>`;
    else if(nDuplas < 2) statusStr = `<span style="color:var(--yellow)">Mínimo 2H + 2F</span>`;
    else {
      const nRodadas = nDuplas;
      const partPorRod = nDuplas%2===0 ? nDuplas/2 : (nDuplas-1)/2;
      const byeInfo = nDuplas%2===1 ? ' · bye rotativo' : '';
      statusStr = `<span style="color:#4ade80">✓ ${nDuplas} duplas → ${nRodadas} rodadas · ${partPorRod} partida${partPorRod!==1?'s':''}/rodada${byeInfo}</span>`;
    }
    playerInput = `
    <div class="section-label">Jogadores <span style="color:var(--yellow)">${nH}H + ${nF}F</span></div>
    <div style="font-size:11px;color:var(--muted2);margin-bottom:8px;line-height:1.5">
      Duplas mistas rotativas — cada H joga com cada M 1x.<br>${statusStr}
    </div>
    <div class="input-row">
      <input class="input-field" id="inp-name" placeholder="Nome do jogador..." maxlength="28" onkeydown="if(event.key==='Enter')addPlayerOrDupla()">
      <select class="input-field" id="inp-gender" style="width:90px;flex:none">
        <option value="M">♂ Homem</option>
        <option value="F">♀ Mulher</option>
      </select>
    </div>
    <button class="btn btn-primary btn-full" onclick="addPlayerOrDupla()" style="margin-bottom:10px">+ Adicionar</button>`;
  } else {
    playerInput = `
    <div class="section-label">Cadastrar Jogadores <span style="color:var(--yellow)">${APP.players.length}/${max}</span></div>
    <div class="input-row">
      <input class="input-field" id="inp-name" placeholder="Nome do jogador..." maxlength="28" onkeydown="if(event.key==='Enter')addPlayerOrDupla()">
    </div>
    <button class="btn btn-primary btn-full" onclick="addPlayerOrDupla()" style="margin-bottom:10px">+ Adicionar</button>`;
  }

  document.getElementById('config-content').innerHTML = `
    <div class="info-card">
      <div class="info-card-header">
        <span class="info-card-icon">${info.icon}</span>
        <span class="info-card-title">${info.label}</span>
      </div>
      <div class="info-card-body">${info.desc}${isSoma?' Acumule mais games do que todos para vencer.':''}</div>
      <div class="info-stat-row">${info.stats.map(s=>`<span class="info-stat">${s}</span>`).join('')}</div>
    </div>
    <div class="accent-line"></div>
    ${fmtOptions}
    <div class="divider"></div>
    ${playerInput}
    <div class="player-list" id="player-list"></div>
  `;

  renderPlayerList();
  updateGerarBtn();
}

function setFmt(fmt, el) {
  APP.fmt = fmt;
  el.closest('.fmt-row').querySelectorAll('.fmt-opt').forEach(e=>e.classList.remove('active'));
  el.classList.add('active');
}

function setIdaVolta(val, el) {
  APP.idaVolta = val;
  el.closest('.fmt-row').querySelectorAll('.fmt-opt').forEach(e=>e.classList.remove('active'));
  el.classList.add('active');
  updateGerarBtn();
}

function addPlayerOrDupla() {
  const m = APP.mode;
  const isAleatorio = IS_ALEATORIO[m];
  const isMistaDupla = IS_MISTA_DUPLA[m];
  const isDupla = IS_DUPLA_FIXA[m] && !isAleatorio && !isMistaDupla; // df
  const isMista = m === 'mista';
  const max = MAX_PLAYERS[m];

  // ── da: Duplas Aleatórias — cadastro individual ──
  if(isAleatorio) {
    const name = document.getElementById('inp-name')?.value.trim();
    if(!name){alert('Informe o nome!');return;}
    if(APP.players.some(p=>p.name===name)){alert('Jogador já cadastrado!');return;}
    APP.players.push({name});
    document.getElementById('inp-name').value='';
    document.getElementById('inp-name').focus();
    renderPlayerList();
    updateGerarBtn();
    return;
  }

  // ── dm: Duplas Mistas — par obrigatório H+M ──
  if(isMistaDupla) {
    const p1 = document.getElementById('inp-p1')?.value.trim(); // Homem
    const p2 = document.getElementById('inp-p2')?.value.trim(); // Mulher
    if(!p1||!p2){alert('Informe o Homem e a Mulher!');return;}
    // Verificar nomes duplicados
    const allNames = APP.players.flatMap(p=>[p.p1,p.p2]);
    if(allNames.includes(p1)){alert(`"${p1}" já está cadastrado!`);return;}
    if(allNames.includes(p2)){alert(`"${p2}" já está cadastrada!`);return;}
    APP.players.push({name:`${p1} / ${p2}`, p1, p2, mista:true});
    document.getElementById('inp-p1').value='';
    document.getElementById('inp-p2').value='';
    document.getElementById('inp-p1').focus();
    renderPlayerList();
    updateGerarBtn();
    return;
  }

  // ── df: Duplas Fixas — par livre ──
  if(isDupla) {
    const p1 = document.getElementById('inp-p1')?.value.trim();
    const p2 = document.getElementById('inp-p2')?.value.trim();
    if(!p1||!p2){alert('Informe os dois jogadores!');return;}
    const allNames = APP.players.flatMap(p=>[p.p1,p.p2]);
    if(allNames.includes(p1)){alert(`"${p1}" já está cadastrado!`);return;}
    if(allNames.includes(p2)){alert(`"${p2}" já está cadastrado!`);return;}
    APP.players.push({name:`${p1} / ${p2}`, p1, p2});
    document.getElementById('inp-p1').value='';
    document.getElementById('inp-p2').value='';
    document.getElementById('inp-p1').focus();
    renderPlayerList();
    updateGerarBtn();
    return;
  }

  // ── mista: Super Mista dinâmica — cadastro individual com gênero ──
  if(isMista) {
    const name = document.getElementById('inp-name')?.value.trim();
    const gen = document.getElementById('inp-gender')?.value;
    if(!name){alert('Informe o nome!');return;}
    if(APP.players.some(p=>p.name===name)){alert('Jogador já cadastrado!');return;}
    APP.players.push({name, gender:gen});
    document.getElementById('inp-name').value='';
    document.getElementById('inp-name').focus();
    renderPlayerList();
    updateGerarBtn();
    return;
  }

  // ── Modalidades individuais (s4/s6/s8/s8x/s12) ──
  {
    const name = document.getElementById('inp-name')?.value.trim();
    if(!name){alert('Informe o nome!');return;}
    if(APP.players.length >= max){alert('Máximo atingido!');return;}
    if(APP.players.some(p=>p.name===name)){alert('Jogador já cadastrado!');return;}
    APP.players.push({name});
    document.getElementById('inp-name').value='';
    document.getElementById('inp-name').focus();
  }
  renderPlayerList();
  updateGerarBtn();
}

function removePlayer(i) {
  APP.players.splice(i,1);
  renderPlayerList();
  updateGerarBtn();
}

function renderPlayerList() {
  const list = document.getElementById('player-list');
  if(!list) return;
  const m = APP.mode;
  const isAleatorio = IS_ALEATORIO[m];
  const isMistaDupla = IS_MISTA_DUPLA[m];

  list.innerHTML = APP.players.map((p,i) => `
    <div class="player-item">
      <div class="p-num">${i+1}</div>
      <div class="p-name">${p.name}</div>
      ${p.gender?`<span class="p-badge ${p.gender}">${p.gender==='M'?'♂':'♀'}</span>`:''}
      ${isMistaDupla?`<span class="p-badge" style="background:rgba(244,192,38,0.15);color:var(--yellow);font-size:9px">MISTA</span>`:''}
      <button class="p-remove" onclick="removePlayer(${i})">✕</button>
    </div>`).join('');

  // Atualizar o counter no label dinamicamente
  const lbl = document.querySelector('#config-content .section-label span[style]');
  if(lbl) {
    const n = APP.players.length;
    const isDupla = IS_DUPLA_FIXA[m];
    if(isAleatorio) lbl.textContent = `${n}`;
    else if(isDupla) lbl.textContent = `${n} dupla${n!==1?'s':''}`;
    else lbl.textContent = `${n}/${MAX_PLAYERS[m]||12}`;
  }

  // Re-renderizar o bloco de status (bye/par) no hint
  const hintEl = document.querySelector('#config-content .section-label + div');
  if(hintEl && IS_DUPLA_FIXA[m] && !isAleatorio) {
    const nD = APP.players.length;
    hintEl.innerHTML = (isMistaDupla
      ? `Cada dupla: 1 Homem + 1 Mulher. Mínimo 3 duplas.`
      : `Mínimo 3 duplas.`)
      + (nD>=3?(nD%2===1
        ? ' <span style="color:var(--yellow)">⚡ Ímpar → bye rotativo por rodada</span>'
        : ' <span style="color:#4ade80">✓ Par de duplas → sem byes</span>'):'');
  }
  if(hintEl && IS_MISTA_ROTATIVA[m]) {
    const nH = APP.players.filter(p=>p.gender==='M').length;
    const nF = APP.players.filter(p=>p.gender==='F').length;
    const nD = Math.min(nH,nF);
    let statusStr = '';
    if(nH===0&&nF===0) statusStr = '<span style="color:var(--muted2)">Mínimo 2H + 2M</span>';
    else if(nH!==nF) statusStr = `<span style="color:var(--yellow)">⚠️ ${nH}H + ${nF}F — precisa ser igual</span>`;
    else if(nD < 2) statusStr = `<span style="color:var(--yellow)">Mínimo 2H + 2F</span>`;
    else {
      const partPorRod = nD%2===0 ? nD/2 : (nD-1)/2;
      const byeInfo = nD%2===1 ? ' · bye rotativo' : '';
      statusStr = `<span style="color:#4ade80">✓ ${nD} duplas → ${nD} rodadas · ${partPorRod} partida${partPorRod!==1?'s':''}/rodada${byeInfo}</span>`;
    }
    hintEl.innerHTML = `Duplas mistas rotativas — cada H joga com cada M 1x.<br>${statusStr}`;
  }
  if(hintEl && isAleatorio) {
    const n = APP.players.length;
    const nD = Math.floor(n/2);
    const parStr = n>=6 ? (n%2===0
      ? `<span style="color:#4ade80">✓ ${n} jogadores → ${nD} duplas → Round Robin</span>`
      : `<span style="color:var(--yellow)">⚠ ${n} jogadores. Adicione mais 1 participante para fechar as duplas.</span>`)
      : `<span style="color:var(--muted2)">Mínimo 6 jogadores (3 duplas)</span>`;
    hintEl.innerHTML = `Duplas sorteadas automaticamente. ${parStr}`;
  }
}

function updateGerarBtn() {
  const btn = document.getElementById('btn-gerar');
  const m = APP.mode;
  const isAleatorio = IS_ALEATORIO[m];
  const isDuplasFixas = IS_DUPLA_FIXA[m] && !isAleatorio;
  const isMistaRot = IS_MISTA_ROTATIVA[m];

  if(isMistaRot) {
    // mista: nH === nF >= 2
    const nH = APP.players.filter(p=>p.gender==='M').length;
    const nF = APP.players.filter(p=>p.gender==='F').length;
    const ok = nH >= 2 && nF >= 2 && nH === nF;
    btn.disabled = !ok;
    if(ok) {
      const n = nH;
      const partPorRod = n%2===0 ? n/2 : (n-1)/2;
      const byeInfo = n%2===1 ? ' · bye' : '';
      btn.textContent = `⚡ Gerar ${n}H + ${n}M → ${n} rodadas${byeInfo}`;
    } else if(nH !== nF) {
      btn.textContent = `⚠️ ${nH}H ≠ ${nF}F — precisam ser iguais`;
    } else {
      const falta = 2 - Math.min(nH,nF);
      btn.textContent = `⚡ Adicione mais ${falta}H e ${falta}F`;
    }
  } else if(isAleatorio) {
    // da: mínimo 6 jogadores (3 duplas)
    const n = APP.players.length;
    const ok = n >= 6 && n % 2 === 0;
    btn.disabled = !ok;
    if(ok) {
      btn.textContent = '🎲 Sortear e Gerar (Round Robin)';
    } else {
      btn.textContent = n >= 6 && n % 2 !== 0
        ? '⚠ Adicione mais 1 participante'
        : `⚡ Adicione mais ${6-n} jogador(es)`;
    }
  } else if(isDuplasFixas) {
    // df ou dm: mínimo 3 duplas, sem máximo
    const n = APP.players.length;
    const ok = n >= 3;
    btn.disabled = !ok;
    if(ok) {
      const realN = n%2===1 ? n : n; // com bye a qtde de duplas reais é n
      const jogos = APP.idaVolta ? n*(n-1) : Math.floor(n*(n-1)/2);
      const byeInfo = n%2===1 ? ' · bye rotativo' : '';
      const ivInfo = APP.idaVolta ? ' · Ida e Volta' : '';
      btn.textContent = `⚡ Gerar ${n} Duplas · ${jogos} jogos${byeInfo}${ivInfo}`;
    } else {
      btn.textContent = `⚡ Adicione mais ${3-n} dupla(s)`;
    }
  } else {
    // Modalidades individuais
    const max = MAX_PLAYERS[m];
    const ok = APP.players.length === max;
    btn.disabled = !ok;
    btn.textContent = ok ? '⚡ Gerar Torneio' : `⚡ Adicione ${max - APP.players.length} jogador(es)`;
  }
}

// ── SCREEN 3 → 4: GERAR ────────────────────────────────
// Fisher-Yates shuffle
function shuffle(arr) {
  const a = [...arr];
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

async function gerarTorneio() {
  const gerarBtn = document.getElementById('btn-gerar');
  if (gerarBtn?.dataset.loading === '1') return;
  const originalBtnText = gerarBtn?.textContent;
  let generated = false;
  if (gerarBtn) {
    gerarBtn.dataset.loading = '1';
    gerarBtn.disabled = true;
    gerarBtn.textContent = 'Validando...';
  }
  try {
    if (typeof validateGuestTournamentLimit === 'function') {
      const guestLimit = await validateGuestTournamentLimit();
      if (!guestLimit.allowed) {
        showGuestLimitReached();
        return;
      }
    }
  } catch(e) {
    alert(e.message || 'Não foi possível validar seu teste grátis agora.');
    return;
  } finally {
    if (gerarBtn && !generated) {
      gerarBtn.dataset.loading = '';
      gerarBtn.disabled = false;
      gerarBtn.textContent = originalBtnText;
    }
  }

  try {
    if (gerarBtn) gerarBtn.textContent = 'Gerando...';

    // Etapa 3: rastrear criação de torneio
    APP._savedCurrentTournament = false;
    APP._trackedTournamentFinished = false;
    try {
    const access = typeof currentAccess === 'function' ? currentAccess() : null;
    trackEvent('tournament_created', {
      format: APP.mode || '',
      category: APP.category || '',
      players: (APP.players || []).length,
      plan: access?.plan || (APP.isGuest ? 'guest' : 'free')
    });
    if (APP.isGuest && !SUPA_USER) {
      trackEvent('guest_tournament_created', {
        format: APP.mode || '',
        category: APP.category || '',
        players: (APP.players || []).length
      });
    }
    } catch(e) {}
  const m = APP.mode;
  const ps = APP.players;
  const isAleatorio = IS_ALEATORIO[m];
  const isMistaDupla = IS_MISTA_DUPLA[m];
  const isDuplaFixa = IS_DUPLA_FIXA[m] && !isAleatorio;
  const isMistaRot = IS_MISTA_ROTATIVA[m];

  // ── mista: Super Mista Dinâmica ───────────────────────
  if(isMistaRot) {
    const men   = ps.filter(p=>p.gender==='M');
    const women = ps.filter(p=>p.gender==='F');
    if(men.length < 2 || women.length < 2 || men.length !== women.length) {
      alert('Precisa de igual quantidade de Homens e Mulheres (mínimo 2 de cada)!');return;
    }
    APP._mistaMen   = shuffle(men.map(p=>p.name));
    APP._mistaWomen = shuffle(women.map(p=>p.name));
    buildMistaRotativa();
    APP.tourneyClosed = false;
    APP._autoNavigateResult = false;
    document.getElementById('torneio-title').textContent = MODE_INFO[m].label;
    renderTorneioScreen();
    goTo('screen-torneio');
    generated = true;
    return;
  }

  // ── da: Duplas Aleatórias ──────────────────────────────
  if(isAleatorio) {
    if(ps.length < 6){alert('Adicione pelo menos 6 jogadores!');return;}
    if(ps.length % 2 !== 0){
      alert('Adicione mais 1 participante para fechar as duplas. Torneios de duplas precisam ter número par de participantes.');
      return;
    }
    const shuffled = shuffle(ps.map(p=>p.name));
    APP.duplasSorteadas = [];
    for(let i=0;i<shuffled.length;i+=2){
      APP.duplasSorteadas.push({p1:shuffled[i], p2:shuffled[i+1]});
    }
    APP._modoReal = 'da';
    APP.players = APP.duplasSorteadas.map(d=>({
      name: `${d.p1} / ${d.p2}`,
      p1: d.p1, p2: d.p2
    }));
    IS_ELIMINATORIO[m] = false;
    buildMatches();
    APP.tourneyClosed = false;
    APP._autoNavigateResult = false;
    document.getElementById('torneio-title').textContent = MODE_INFO[m].label;
    renderTorneioScreen();
    goTo('screen-torneio');
    generated = true;
    return;
  }

  // ── df / dm: Duplas Fixas (ou Mistas) ─────────────────
  if(isDuplaFixa) {
    if(ps.length < 3){alert('Adicione pelo menos 3 duplas!');return;}
    if(isMistaDupla) {
      // Verificar que cada dupla tem H e M (já garantido no add, mas checagem dupla)
      const invalid = ps.some(p=>!p.mista);
      if(invalid){alert('Erro: dupla inválida encontrada.');return;}
    }
    // Bye rotativo: se ímpar, adicionar dupla fantasma __BYE__
    if(ps.length%2===1){
      APP._hasBye = true;
      APP.players = [...ps, {name:'__BYE__', isBye:true}];
    } else {
      APP._hasBye = false;
    }
    buildMatchesRRComBye();
    APP.tourneyClosed = false;
    APP._autoNavigateResult = false;
    document.getElementById('torneio-title').textContent = MODE_INFO[m].label;
    renderTorneioScreen();
    goTo('screen-torneio');
    generated = true;
    return;
  }

  // ── Modalidades individuais (s4/s6/s8/s8x/s12/mista) ──
  const max = MAX_PLAYERS[m];
  if(ps.length !== max) {
    alert('Cadastre todos os jogadores!');return;
  }
  buildMatches();
  APP.tourneyClosed = false;
  APP._autoNavigateResult = false;
  document.getElementById('torneio-title').textContent = MODE_INFO[APP.mode].label;
  renderTorneioScreen();
  goTo('screen-torneio');
  generated = true;
  } catch(e) {
    console.error('Erro ao gerar torneio:', e);
    alert(e.message || 'Não foi possível gerar o torneio. Tente novamente.');
  } finally {
    if (gerarBtn && !generated) {
      gerarBtn.dataset.loading = '';
      gerarBtn.disabled = false;
      gerarBtn.textContent = originalBtnText;
    }
  }
}

// ── Gera chaves eliminatórias com byes automáticos ─────────────────────────
function buildEliminatoria(duplas) {
  APP.matches = [];
  const n = duplas.length;

  // Calcular potência de 2 >= n para determinar byes
  let pot = 1;
  while(pot < n) pot *= 2;
  const nByes = pot - n; // quantas duplas passam direto

  // Seeding: intercalar cabeças-de-chave e último para equilibrar
  // Distribuição: 1ª metade vai para posições ímpares, 2ª para pares
  const seeded = [...duplas];

  // Montar bracket: posições 0..pot-1
  const bracket = new Array(pot).fill(null);
  // Cabeças recebem as primeiras posições, byes ficam distribuídos
  // Estratégia simples: primeiras (pot-n) posições são byes, restantes são duplas
  let byeCount = nByes;
  let di = 0;
  const slots = [];
  for(let i=0;i<pot;i++){
    if(byeCount > 0 && i < byeCount) {
      slots.push(null); // bye
    } else {
      slots.push(seeded[di++]);
    }
  }

  // Gerar partidas da 1ª rodada
  let matchIdx = 0;
  const r1Winners = []; // quem avança da rodada 1

  for(let i=0;i<pot;i+=2){
    const a = slots[i];
    const b = slots[i+1];
    if(a===null) {
      // b tem bye — avança direto
      r1Winners.push({team:b, idx: matchIdx++, isBye:true});
    } else if(b===null) {
      // a tem bye — avança direto
      r1Winners.push({team:a, idx: matchIdx++, isBye:true});
    } else {
      // Partida real
      const id = `e_r1_${matchIdx}`;
      APP.matches.push({
        id, phase:'elim', round:1, pos:matchIdx,
        a, b, sA:null, sB:null,
        label:`R1 J${matchIdx+1}`
      });
      r1Winners.push({matchId:id, idx:matchIdx, isBye:false});
      matchIdx++;
    }
  }

  // Gerar rodadas seguintes até a Final
  // Armazenar estrutura de rodadas para o bracket
  APP._bracket = {rounds:[], r1Winners};

  // Rodadas 2 em diante — criar placeholders
  let currentRound = r1Winners;
  let roundNum = 2;
  while(currentRound.length > 1) {
    const nextRound = [];
    for(let i=0;i<currentRound.length;i+=2){
      const slot1 = currentRound[i];
      const slot2 = currentRound[i+1];
      const isFinal = currentRound.length === 2;
      const label = isFinal ? 'Final' : (currentRound.length===4?`Semi ${i/2+1}`:`R${roundNum} J${i/2+1}`);
      const id = `e_r${roundNum}_${i/2}`;
      const phase = isFinal ? 'final' : 'elim';

      // Preencher time A e B se já conhecidos (byes da rodada anterior)
      const teamA = slot1.isBye ? slot1.team : '';
      const teamB = slot2.isBye ? slot2.team : '';

      APP.matches.push({
        id, phase, round:roundNum, pos:i/2,
        a:teamA, b:teamB, sA:null, sB:null,
        label, prevA:slot1, prevB:slot2
      });
      nextRound.push({matchId:id, idx:i/2, isBye:false, round:roundNum});
    }
    currentRound = nextRound;
    roundNum++;
  }
}

// Resolve o vencedor de um match do bracket e propaga para próxima rodada
function propagateBracket(finishedId) {
  const finished = APP.matches.find(x=>x.id===finishedId);
  if(!finished||finished.sA===null||finished.sB===null) return;
  const winner = finished.sA>finished.sB?finished.a:finished.sB>finished.sA?finished.b:null;
  if(!winner) return;

  // Encontrar o match que depende deste resultado
  const dependents = APP.matches.filter(mx=>
    mx.prevA?.matchId===finishedId || mx.prevB?.matchId===finishedId
  );
  dependents.forEach(mx=>{
    if(mx.prevA?.matchId===finishedId) mx.a = winner;
    if(mx.prevB?.matchId===finishedId) mx.b = winner;
  });
}

function buildMatchesRRComBye() {
  // Round Robin circular com suporte a bye rotativo e ida e volta
  const ps = APP.players.map(p=>p.name); // inclui '__BYE__' se ímpar
  APP.matches = [];
  let idx = 0;

  const teams = [...ps];
  const n = teams.length; // sempre par
  const totalRounds = n - 1;

  // Gerar uma "volta" de rodadas via rotação circular
  function gerarVolta(offset, labelPrefix) {
    const t = [...teams]; // cópia para rotação
    for(let r=0; r<totalRounds; r++) {
      const roundNum = offset + r + 1;
      for(let i=0; i<n/2; i++) {
        const a = t[i];
        const b = t[n-1-i];
        const isByeMatch = a==='__BYE__' || b==='__BYE__';
        const realTeam = isByeMatch ? (a==='__BYE__'?b:a) : null;
        // Na volta, inverter a e b para "jogar em casa diferente"
        const teamA = labelPrefix==='volta' ? b : a;
        const teamB = labelPrefix==='volta' ? a : b;
        const isByeA = teamA==='__BYE__';
        const isByeB = teamB==='__BYE__';
        APP.matches.push({
          id: `${labelPrefix}r${r}m${idx++}`,
          phase: 'rr',
          roundNum,
          volta: labelPrefix==='volta',
          a: isByeA ? '__BYE__' : teamA,
          b: isByeB ? '__BYE__' : teamB,
          sA: isByeMatch ? (teamA!=='__BYE__'?1:0) : null,
          sB: isByeMatch ? (teamB!=='__BYE__'?1:0) : null,
          isBye: isByeMatch,
          byeWinner: realTeam || null,
        });
      }
      // Rotação: fixar primeiro, rodar o resto
      const last = t.pop();
      t.splice(1, 0, last);
    }
  }

  gerarVolta(0, 'ida');

  if(APP.idaVolta) {
    gerarVolta(totalRounds, 'volta');
  }
}

// ── Super Mista Rotativa: cada H joga com cada M 1x ──────
function buildMistaRotativa() {
  const homens   = APP._mistaMen;   // array de nomes (já shuffled)
  const mulheres = APP._mistaWomen; // array de nomes (já shuffled)
  const n = homens.length; // === mulheres.length
  APP.matches = [];
  let idx = 0;

  for(let r = 0; r < n; r++) {
    // Formar as n duplas desta rodada: H[i] + M[(i+r) % n]
    const duplas = homens.map((h, i) => ({
      h, m: mulheres[(i + r) % n],
      name: `${h} + ${mulheres[(i + r) % n]}`
    }));

    // Se n ímpar: a dupla de índice (r % n) descansa (bye rotativo)
    let byeDupla = null;
    let jogando = duplas;
    if(n % 2 === 1) {
      byeDupla = duplas[r % n];
      jogando = duplas.filter((_, i) => i !== (r % n));
    }

    // Parear as duplas: metade inferior vs metade superior
    const mid = jogando.length / 2;
    const totalCourts = mid;
    for(let i = 0; i < mid; i++) {
      const dA = jogando[i];
      const dB = jogando[i + mid];
      APP.matches.push({
        id: `mr${r}c${i}`,
        phase: 'round',
        roundNum: r + 1,
        courtNum: i + 1,
        totalCourts,
        pA0: dA.h, pA1: dA.m,
        pB0: dB.h, pB1: dB.m,
        teamA: dA.name,
        teamB: dB.name,
        restNames: byeDupla ? byeDupla.name : '',
        sA: null, sB: null,
      });
    }
  }
}

function buildMatches() {
  const m = APP.mode;
  const ps = APP.players.map(p=>p.name);
  const isDupla = IS_DUPLA_FIXA[m];
  const isElim = IS_ELIMINATORIO[m];
  APP.matches = [];

  // ── Eliminatória (da com ímpar) ──────────────────────
  if(isElim) {
    buildEliminatoria(ps);
    return;
  }

  // ── Duplas Fixas/Mistas/Aleatórias (par) → RR simples ──
  if(isDupla) {
    let idx=0;
    // Ida
    for(let i=0;i<ps.length;i++)
      for(let j=i+1;j<ps.length;j++)
        APP.matches.push({id:`m${idx++}`,phase:'rr',roundNum:null,a:ps[i],b:ps[j],sA:null,sB:null});
    // Volta (se habilitado)
    if(APP.idaVolta) {
      for(let i=0;i<ps.length;i++)
        for(let j=i+1;j<ps.length;j++)
          APP.matches.push({id:`mv${idx++}`,phase:'rr',roundNum:null,volta:true,a:ps[j],b:ps[i],sA:null,sB:null});
    }
    return;
  }

  // ── Modalidades individuais rotativas ──────────────────
  const schedKey = m==='s8x'?'s8':m==='mista'?'mista':m;
  const sched = SCHEDULES[schedKey];
  sched.forEach((round,ri)=>{
    round.c.forEach((court,ci)=>{
      APP.matches.push({
        id:`r${ri}c${ci}`,phase:'round',
        roundNum:ri+1,courtNum:ci+1,totalCourts:round.c.length,
        pA0:ps[court.d1[0]],pA1:ps[court.d1[1]],
        pB0:ps[court.d2[0]],pB1:ps[court.d2[1]],
        teamA:ps[court.d1[0]]+' + '+ps[court.d1[1]],
        teamB:ps[court.d2[0]]+' + '+ps[court.d2[1]],
        restNames:(round.r||[]).map(i=>ps[i]).join(', '),
        sA:null,sB:null,
      });
    });
  });
  if(APP.fmt==='final'){
    APP.matches.push({id:'fn',phase:'final',roundNum:null,courtNum:1,totalCourts:1,
      pA0:'',pA1:'',pB0:'',pB1:'',teamA:'',teamB:'',restNames:'',sA:null,sB:null});
  }
}

// ── RENDER TORNEIO SCREEN ───────────────────────────────
function renderTorneioScreen() {
  const m = APP.mode;
  const isDupla = IS_DUPLA_FIXA[m];
  const rounds = APP.matches.filter(x=>(x.phase==='round'||x.phase==='rr')&&!x.isBye);
  const done = rounds.filter(x=>x.sA!==null).length;
  const total = rounds.length;

  document.getElementById('torneio-chip').textContent = `${done}/${total} jogos`;

  if(IS_ELIMINATORIO[m]) renderEliminatoriaRounds();
  else if(isDupla) renderDuplaFixaRounds();
  else renderRotativoRounds();

  updateFooterRanking();
  updateSeeAllBtn();
}

function renderRotativoRounds() {
  const m = APP.mode;
  const isMistaRot = IS_MISTA_ROTATIVA[m];
  const rounds = APP.matches.filter(x=>x.phase==='round');
  const final = APP.matches.find(x=>x.phase==='final');

  // Descobrir quantas rodadas existem pelos matches (funciona para mista dinâmica E schedules fixos)
  const totalRounds = isMistaRot
    ? Math.max(...rounds.map(x=>x.roundNum||1))
    : SCHEDULES[m==='s8x'?'s8':m].length;

  let html='';

  for(let ri=0; ri<totalRounds; ri++){
    const rMatches = rounds.filter(x=>x.roundNum===ri+1);
    const allDone = rMatches.length>0 && rMatches.every(x=>x.sA!==null);
    const restText = rMatches[0]?.restNames||'';
    html+=`<div class="round-block">
      <div class="round-header">
        <span class="round-tag">Rodada ${ri+1}</span>
        ${restText?`<span class="rest-tag">💤 ${restText}</span>`:''}
        ${allDone?`<span class="round-done-tag">✓ Concluída</span>`:''}
      </div>`;
    rMatches.forEach(mx=>{ html+=matchCard(mx); });
    html+=`</div>`;
  }

  if(final){
    const ps = APP.players.map(p=>p.name);
    const allRounds = APP.matches.filter(x=>x.phase==='round');
    const stand = calcIndivStandings(ps,allRounds);
    if(stand.length>=2){ final.teamA=stand[0].name; final.teamB=stand[1].name;
      final.pA0=stand[0].name; final.pA1=''; final.pB0=stand[1].name; final.pB1=''; }
    html+=`<div class="round-block" style="border-color:rgba(244,192,38,0.25)">
      <div class="round-header"><span class="round-tag" style="color:var(--yellow-l)">🏆 Final</span></div>
      ${finalCard(final)}
    </div>`;
  }

  document.getElementById('rounds-area').innerHTML = html;
  requestAnimationFrame(() => applyRoundLock());
}

function renderDuplaFixaRounds() {
  const m = APP.mode;
  const hasBye = APP._hasBye;
  const idaVolta = APP.idaVolta;
  const allMatches = APP.matches.filter(x=>x.phase==='rr');

  // Agrupar por rodada (se tiver roundNum, usar; senão flat por ida/volta)
  const byRound = {};
  allMatches.forEach(mx=>{
    const volta = mx.volta ? 'V' : 'I';
    const r = mx.roundNum != null ? `${volta}_${mx.roundNum}` : volta;
    if(!byRound[r]) byRound[r]=[];
    byRound[r].push(mx);
  });

  // Ordenar: primeiro todas as rodadas de ida, depois as de volta
  const roundKeys = Object.keys(byRound).sort((a,b)=>{
    const aV = a.startsWith('V') ? 1 : 0;
    const bV = b.startsWith('V') ? 1 : 0;
    if(aV!==bV) return aV-bV;
    // Ordenar por número dentro do grupo
    const aN = parseInt(a.split('_')[1])||0;
    const bN = parseInt(b.split('_')[1])||0;
    return aN-bN;
  });

  const hasRounds = hasBye || roundKeys.some(k=>k.includes('_'));

  let html = '';
  let lastPhase = ''; // 'ida' | 'volta'

  roundKeys.forEach(key => {
    const rMatches = byRound[key];
    const isVolta = key.startsWith('V');
    const phase = isVolta ? 'volta' : 'ida';
    const rNum = parseInt(key.split('_')[1]) || null;
    const realMatches = rMatches.filter(mx=>!mx.isBye);
    const byeMatch = rMatches.find(mx=>mx.isBye);
    const allDone = realMatches.length ? realMatches.every(mx=>mx.sA!==null) : true;

    // Cabeçalho de seção Ida / Volta
    if(idaVolta && phase !== lastPhase) {
      lastPhase = phase;
      html += `<div style="text-align:center;padding:8px 0 4px;font-family:'Bebas Neue';font-size:13px;letter-spacing:2px;color:var(--muted2)">${isVolta?'↩ VOLTA':'↪ IDA'}</div>`;
    }

    if(hasRounds && rNum) {
      html += `<div class="round-block">
        <div class="round-header">
          <span class="round-tag">Rodada ${rNum}${isVolta?' (V)':''}</span>
          ${byeMatch?`<span class="rest-tag">💤 ${byeMatch.byeWinner} descansa</span>`:''}
          ${allDone&&realMatches.length?`<span class="round-done-tag">✓ Concluída</span>`:''}
        </div>`;
      realMatches.forEach(mx=>{ html+=simpleDuplaCard(mx); });
      html+=`</div>`;
    } else {
      // Flat (da par sem rodadas)
      const rrDone = realMatches.every(x=>x.sA!==null);
      const blkLabel = idaVolta ? (isVolta?'Volta':'Ida') : 'Round Robin';
      html+=`<div class="round-block">
        <div class="round-header">
          <span class="round-tag">${blkLabel}</span>
          ${rrDone?`<span class="round-done-tag">✓ Concluído</span>`:''}
        </div>`;
      realMatches.forEach(mx=>{ html+=simpleDuplaCard(mx); });
      html+=`</div>`;
    }
  });

  document.getElementById('rounds-area').innerHTML = html;
  requestAnimationFrame(() => applyRoundLock());
}


// ── Render eliminatória (bracket) ──────────────────────────────
function renderEliminatoriaRounds() {
  const matches = APP.matches;
  // Agrupar por rodada
  const rounds = {};
  matches.forEach(mx=>{
    const r = mx.round || 1;
    if(!rounds[r]) rounds[r]=[];
    rounds[r].push(mx);
  });
  const roundNums = Object.keys(rounds).map(Number).sort((a,b)=>a-b);
  const totalRounds = roundNums.length;

  let html = '';
  roundNums.forEach((rn,ri)=>{
    const rMatches = rounds[rn];
    const allDone = rMatches.every(mx=>mx.sA!==null||mx.a===''||mx.b==='');
    const isFinalRound = rMatches.some(mx=>mx.phase==='final');
    const label = isFinalRound ? '🏆 Final' : (rMatches.length===2?'Semifinais':rMatches.length===1&&!isFinalRound?`${rMatches[0].label}`:`Rodada ${rn}`);
    const borderStyle = isFinalRound ? 'border-color:rgba(244,192,38,0.25)' : rMatches.length<=2&&rn>1?'border-color:rgba(26,127,196,0.25)':'';

    html += `<div class="round-block" id="rb-elim-${rn}" ${borderStyle?`style="${borderStyle}"`:''}>
      <div class="round-header">
        <span class="round-tag" ${isFinalRound?'style="color:var(--yellow-l)"':''}>${label}</span>
        ${allDone&&rMatches.some(mx=>mx.sA!==null)?`<span class="round-done-tag">✓ Concluída</span>`:''}
      </div>`;

    rMatches.forEach(mx=>{
      const hasTeams = mx.a && mx.b;
      const done = mx.sA!==null&&mx.sB!==null;
      const aW=done&&mx.sA>mx.sB, bW=done&&mx.sB>mx.sA;

      if(!hasTeams) {
        html += `<div class="match-card" id="mc-${mx.id}" style="opacity:0.4">
          <span class="court-tag">${mx.label||'Aguardando'}</span>
          <div class="match-teams">
            <span class="t-name">${mx.a||'Aguardando...'}</span>
            <span class="vs-badge">VS</span>
            <span class="t-name">${mx.b||'Aguardando...'}</span>
          </div>
        </div>`;
      } else {
        html += `<div class="match-card" id="mc-${mx.id}">
          <span class="court-tag">${mx.label||'Jogo'}</span>
          <div class="match-teams">
            <span class="t-name${aW?' won':''}">${mx.a}</span>
            <span class="vs-badge">VS</span>
            <span class="t-name${bW?' won':''}">${mx.b}</span>
          </div>
          ${done?`<span class="win-tag">🏅 ${aW?mx.a:mx.b}</span>`:`
          <div class="score-row">
            <input class="score-input" type="number" min="0" max="99" value="${mx.sA??''}" placeholder="—" oninput="tmpScore('${mx.id}',0,this.value);checkConfirmBtn('${mx.id}')">
            <span class="score-sep">×</span>
            <input class="score-input" type="number" min="0" max="99" value="${mx.sB??''}" placeholder="—" oninput="tmpScore('${mx.id}',1,this.value);checkConfirmBtn('${mx.id}')">
            <button class="confirm-btn" id="cbtn-${mx.id}" ${(mx.sA!==null&&mx.sB!==null)?'':'disabled'} ${isFinalRound?'style="background:var(--yellow);color:#080f18"':''} onclick="confirmScore('${mx.id}')">✓</button>
          </div>`}
        </div>`;
      }
    });
    html += '</div>';
  });

  document.getElementById('rounds-area').innerHTML = html;
  requestAnimationFrame(() => applyRoundLockElim());
}

// Lock para eliminatória: bloqueia rodadas futuras
function applyRoundLockElim() {
  const matches = APP.matches;
  const rounds = {};
  matches.forEach(mx=>{ const r=mx.round||1; if(!rounds[r])rounds[r]=[]; rounds[r].push(mx); });
  const roundNums = Object.keys(rounds).map(Number).sort((a,b)=>a-b);

  roundNums.forEach((rn,ri)=>{
    const block = document.getElementById(`rb-elim-${rn}`);
    if(!block) return;
    if(ri===0){
      block.classList.remove('locked');
      return;
    }
    // Verificar se a rodada anterior está toda concluída
    const prevRound = rounds[roundNums[ri-1]];
    const prevDone = prevRound.every(mx=>mx.sA!==null||(!mx.a||!mx.b));
    if(prevDone) block.classList.remove('locked');
    else block.classList.add('locked');
  });
}

// ── MATCH CARDS ─────────────────────────────────────────
function matchCard(mx) {
  const done = mx.sA!==null&&mx.sB!==null;
  const aW=done&&mx.sA>mx.sB, bW=done&&mx.sB>mx.sA;
  const multi = mx.totalCourts>1;
  return `<div class="match-card" id="mc-${mx.id}">
    ${multi?`<span class="court-tag">Q${mx.courtNum}</span>`:''}
    <div class="match-teams super-match-teams">
      <div class="super-team${aW?' won':''}">
        <span class="super-team-label">Dupla A</span>
        <span class="super-team-names">${mx.pA0} <span>+</span> ${mx.pA1}</span>
      </div>
      <span class="vs-badge">VS</span>
      <div class="super-team${bW?' won':''}">
        <span class="super-team-label">Dupla B</span>
        <span class="super-team-names">${mx.pB0} <span>+</span> ${mx.pB1}</span>
      </div>
    </div>
    <div class="score-row">
      <input class="score-input" type="number" min="0" max="99" value="${mx.sA??''}" placeholder="—" oninput="tmpScore('${mx.id}',0,this.value);checkConfirmBtn('${mx.id}')">
      <span class="score-sep">×</span>
      <input class="score-input" type="number" min="0" max="99" value="${mx.sB??''}" placeholder="—" oninput="tmpScore('${mx.id}',1,this.value);checkConfirmBtn('${mx.id}')">
      <button class="confirm-btn" id="cbtn-${mx.id}" ${(mx.sA!==null&&mx.sB!==null)?'':'disabled'} onclick="confirmScore('${mx.id}')">✓</button>
    </div>
    ${done?`<span class="win-tag">🏅 ${aW?mx.teamA:mx.teamB}</span>`:''}
  </div>`;
}

function simpleDuplaCard(mx) {
  // Match de bye: exibir como "Folga" sem inputs
  if(mx.isBye) {
    return `<div class="match-card" id="mc-${mx.id}" style="opacity:0.55;border-style:dashed">
      <span class="court-tag" style="color:var(--muted2)">💤 Folga</span>
      <div class="match-teams">
        <span class="t-name" style="color:var(--muted)">${mx.byeWinner}</span>
        <span class="vs-badge" style="color:var(--muted2)">W.O.</span>
        <span class="t-name" style="color:var(--muted2)">BYE</span>
      </div>
    </div>`;
  }
  const done = mx.sA!==null&&mx.sB!==null;
  const aW=done&&mx.sA>mx.sB, bW=done&&mx.sB>mx.sA;
  const hasP = mx.a&&mx.b&&mx.a!=='__BYE__'&&mx.b!=='__BYE__';
  const label = mx.label||'Jogo';
  return `<div class="match-card" id="mc-${mx.id}">
    <span class="court-tag">${label}</span>
    <div class="match-teams">
      <span class="t-name${aW?' won':''}">${mx.a||'—'}</span>
      <span class="vs-badge">VS</span>
      <span class="t-name${bW?' won':''}">${mx.b||'—'}</span>
    </div>
    ${hasP?`<div class="score-row">
      <input class="score-input" type="number" min="0" max="99" value="${mx.sA??''}" placeholder="—" oninput="tmpScore('${mx.id}',0,this.value);checkConfirmBtn('${mx.id}')">
      <span class="score-sep">×</span>
      <input class="score-input" type="number" min="0" max="99" value="${mx.sB??''}" placeholder="—" oninput="tmpScore('${mx.id}',1,this.value);checkConfirmBtn('${mx.id}')">
      <button class="confirm-btn" id="cbtn-${mx.id}" ${(mx.sA!==null&&mx.sB!==null)?'':'disabled'} onclick="confirmDupla('${mx.id}')">✓</button>
    </div>`:''}
    ${done?`<span class="win-tag">🏅 ${aW?mx.a:mx.b}</span>`:''}
  </div>`;
}

function finalCard(fx) {
  if(!fx.teamA||!fx.teamB) return `<div class="match-card"><span style="color:var(--muted);font-size:12px">Aguardando rodadas...</span></div>`;
  const done = fx.sA!==null&&fx.sB!==null;
  const aW=done&&fx.sA>fx.sB, bW=done&&fx.sB>fx.sA;
  return `<div class="match-card" id="mc-${fx.id}">
    <div class="match-teams">
      <span class="t-name${aW?' won':''}">${fx.teamA}</span>
      <span class="vs-badge">VS</span>
      <span class="t-name${bW?' won':''}">${fx.teamB}</span>
    </div>
    <div class="score-row">
      <input class="score-input" type="number" min="0" max="99" value="${fx.sA??''}" placeholder="—" oninput="tmpScore('${fx.id}',0,this.value);checkConfirmBtn('${fx.id}')">
      <span class="score-sep">×</span>
      <input class="score-input" type="number" min="0" max="99" value="${fx.sB??''}" placeholder="—" oninput="tmpScore('${fx.id}',1,this.value);checkConfirmBtn('${fx.id}')">
      <button class="confirm-btn" id="cbtn-${fx.id}" ${(fx.sA!==null&&fx.sB!==null)?'':'disabled'} style="background:${(fx.sA!==null&&fx.sB!==null)?'var(--yellow)':'rgba(255,255,255,0.08)'};color:${(fx.sA!==null&&fx.sB!==null)?'#080f18':'rgba(255,255,255,0.2)'}" onclick="confirmFinal('${fx.id}')">✓</button>
    </div>
    ${done?`<span class="win-tag">🏆 ${aW?fx.teamA:fx.teamB}</span>`:''}
  </div>`;
}

// ── SCORE ────────────────────────────────────────────────
const TMPSCORES = {};
function tmpScore(id,idx,val){
  if(!TMPSCORES[id]) TMPSCORES[id]=[null,null];
  TMPSCORES[id][idx]=val===''?null:parseInt(val);
}

// Habilita o ✓ só quando os dois campos têm valor E não é empate
function checkConfirmBtn(id) {
  const btn = document.getElementById('cbtn-' + id);
  if (!btn) return;
  const card = document.getElementById('mc-' + id);
  if (!card) return;
  const inputs = card.querySelectorAll('input[type=number]');
  const v0 = inputs[0]?.value;
  const v1 = inputs[1]?.value;
  const bothFilled = v0 !== '' && v1 !== '';
  const isEmpate = bothFilled && parseInt(v0) === parseInt(v1);

  btn.disabled = !bothFilled || isEmpate;

  // Mensagem de empate inline
  let warn = card.querySelector('.empate-warn');
  if(isEmpate) {
    if(!warn) {
      warn = document.createElement('div');
      warn.className = 'empate-warn';
      warn.style.cssText = 'color:#f87171;font-size:11px;text-align:center;margin-top:4px;font-weight:500';
      warn.textContent = '⚠️ Empate não permitido — alguém precisa vencer';
      card.querySelector('.score-row')?.after(warn);
    }
  } else {
    warn?.remove();
  }

  // Cor dinâmica do botão final (amarelo)
  if (btn.style.background) {
    const ok = bothFilled && !isEmpate;
    btn.style.background = ok ? 'var(--yellow)' : 'rgba(255,255,255,0.08)';
    btn.style.color = ok ? '#080f18' : 'rgba(255,255,255,0.2)';
  }
}

function confirmScore(id){
  const card=document.getElementById('mc-'+id);
  const inputs=card.querySelectorAll('input');
  if(inputs[0].value===''||inputs[1].value===''){alert('Informe os dois placares!');return;}
  const sA=parseInt(inputs[0].value), sB=parseInt(inputs[1].value);
  if(sA===sB){alert('Empate não é permitido!\nUm dos times precisa ter pelo menos 1 set a mais.');return;}
  const mx=APP.matches.find(x=>x.id===id);
  mx.sA=sA; mx.sB=sB;
  // Propagar resultado no bracket (eliminatória)
  if(IS_ELIMINATORIO[APP.mode]) propagateBracket(id);
  // Marcar que veio de uma confirmação → auto-navega se for a última
  APP._autoNavigateResult = true;
  renderTorneioScreen();
  checkTourneyComplete();
}

function confirmDupla(id){
  const card=document.getElementById('mc-'+id);
  const inputs=card.querySelectorAll('input');
  if(inputs[0].value===''||inputs[1].value===''){alert('Informe os dois placares!');return;}
  const sA=parseInt(inputs[0].value), sB=parseInt(inputs[1].value);
  if(sA===sB){alert('Empate não é permitido!\nUma das duplas precisa ter pelo menos 1 set a mais.');return;}
  const mx=APP.matches.find(x=>x.id===id);
  mx.sA=sA; mx.sB=sB;
  APP._autoNavigateResult = true;
  renderTorneioScreen();
  checkTourneyComplete();
}

function confirmFinal(id){
  confirmScore(id);
}

function checkTourneyComplete(){
  // Matches de bye já vêm com sA/sB preenchidos — excluir do check de "tudo confirmado"
  const rounds=APP.matches.filter(x=>(x.phase==='round'||x.phase==='rr'||x.phase==='elim'||x.phase==='final')&&!x.isBye);
  const allDone=rounds.length>0&&rounds.every(x=>x.sA!==null);
  // Atualiza flag — permite re-detecção após correção
  APP.tourneyClosed = allDone;
  if(allDone){
    // Atualiza o footer e botão imediatamente
    updateFooterRanking();
    updateSeeAllBtn();
    // Navega automaticamente apenas se veio de uma confirmação (não de volta da tela)
    if(APP._autoNavigateResult){
      APP._autoNavigateResult = false;
      verResultadoFinal(true);
    }
  } else {
    updateSeeAllBtn();
  }
}

// Atualiza o botão do rodapé conforme estado do torneio
function updateSeeAllBtn(){
  const rounds=APP.matches.filter(x=>x.phase==='round'||x.phase==='rr');
  const allDone=rounds.every(x=>x.sA!==null);
  const footer=document.getElementById('footer-ranking');
  if(!footer) return;
  const btn=footer.querySelector('.see-all-btn');
  if(!btn) return;
  if(allDone){
    btn.textContent='🏆 Ver Resultado Final →';
    btn.style.color='var(--yellow)';
    btn.style.fontWeight='700';
    btn.style.fontSize='13px';
    btn.onclick=()=>verResultadoFinal(false);
  } else {
    btn.textContent='Ver ranking completo ↑';
    btn.style.color='';
    btn.style.fontWeight='';
    btn.style.fontSize='';
    btn.onclick=()=>verResultadoFinal(false);
  }
}

// ── Retorna o índice da rodada atual (0-based)
// Para rotativos: rodada = grupo de partidas com mesmo roundNum
// Para duplas fixas: índice sequencial individual
function getActiveRoundIndex() {
  const m = APP.mode;
  const isDupla = IS_DUPLA_FIXA[m];
  if (isDupla) {
    const rr = APP.matches.filter(x => x.phase === 'rr');
    const firstPending = rr.findIndex(x => x.sA === null);
    return firstPending === -1 ? rr.length : firstPending;
  } else {
    // Rotativo (individual ou mista dinâmica): liberar por roundNum
    const roundMatches = APP.matches.filter(x=>x.phase==='round');
    const totalRounds = Math.max(0, ...roundMatches.map(x=>x.roundNum||1));
    for (let ri = 0; ri < totalRounds; ri++) {
      const rMatches = roundMatches.filter(x => x.roundNum === ri + 1);
      if (rMatches.some(x => x.sA === null)) return ri;
    }
    return totalRounds;
  }
}

// ── Habilitar/desabilitar inputs de uma rodada no DOM
function applyRoundLock() {
  const m = APP.mode;
  const isDupla = IS_DUPLA_FIXA[m];
  // Eliminatória tem seu próprio lock
  if(IS_ELIMINATORIO[m]){ applyRoundLockElim(); return; }

  if (isDupla) {
    const hasBye = APP._hasBye;

    if(hasBye) {
      // Com rodadas: liberar rodada por rodada
      // Coletar rodadas únicas em ordem (ida antes, volta depois)
      const keys = [...new Set(
        APP.matches.filter(x=>x.phase==='rr').map(x=>{
          const v = x.volta?'V':'I';
          return x.roundNum!=null ? `${v}_${x.roundNum}` : v;
        })
      )].sort((a,b)=>{
        const aV=a.startsWith('V')?1:0, bV=b.startsWith('V')?1:0;
        if(aV!==bV) return aV-bV;
        return (parseInt(a.split('_')[1])||0)-(parseInt(b.split('_')[1])||0);
      });

      // Descobrir a rodada ativa: primeira que ainda tem partidas pendentes
      let activeKey = keys[keys.length-1];
      for(const key of keys) {
        const realMxs = APP.matches.filter(x=>x.phase==='rr'&&!x.isBye&&(()=>{
          const v=x.volta?'V':'I'; const k=x.roundNum!=null?`${v}_${x.roundNum}`:v; return k===key;
        })());
        if(realMxs.some(x=>x.sA===null)){activeKey=key; break;}
      }

      // Aplicar lock por round-tag
      const roundBlocks = document.querySelectorAll('#rounds-area .round-block');
      let blockIdx = 0;
      roundBlocks.forEach(block=>{
        const tag = block.querySelector('.round-tag');
        if(!tag) return;
        const txt = tag.textContent.trim();
        // Mapear texto da tag para key
        const vMatch = txt.match(/Rodada\s+(\d+)(\s*\(V\))?/i);
        if(!vMatch) return;
        const rn = parseInt(vMatch[1]);
        const isVolta = !!vMatch[2];
        const key = `${isVolta?'V':'I'}_${rn}`;
        const keyIdx = keys.indexOf(key);
        const activeIdx = keys.indexOf(activeKey);
        if(keyIdx <= activeIdx) {
          block.classList.remove('locked');
        } else {
          block.classList.add('locked');
          if(!block.querySelector('.round-lock-tag')){
            const h=block.querySelector('.round-header');
            if(h){const t=document.createElement('span');t.className='round-lock-tag';t.textContent='🔒';h.appendChild(t);}
          }
        }
      });
    } else {
      // Sem rodadas (RR flat): destravar todos os cards
      const rr = APP.matches.filter(x=>x.phase==='rr');
      rr.forEach(mx=>{
        const card=document.getElementById('mc-'+mx.id);
        if(card) card.classList.remove('locked');
      });
    }
  } else {
    const schedKey = m==='s8x'?'s8':m==='mista'?'mista':m;
    const sched = SCHEDULES[schedKey];
    const activeRound = getActiveRoundIndex(); // 0-based

    // Blocos de rodada — procurar por round-tag com "Rodada N"
    const roundBlocks = document.querySelectorAll('#rounds-area .round-block');
    roundBlocks.forEach((block, bi) => {
      const tag = block.querySelector('.round-tag');
      if (!tag) return; // bloco final (sem round-tag de número)
      const tagText = tag.textContent.trim();
      const match = tagText.match(/Rodada\s+(\d+)/i);
      if (!match) return;
      const ri = parseInt(match[1]) - 1; // 0-based

      if (ri < activeRound) {
        block.classList.remove('locked'); // concluída
      } else if (ri === activeRound) {
        block.classList.remove('locked'); // ativa
      } else {
        block.classList.add('locked');    // futura
        // Garantir tag de lock
        if (!block.querySelector('.round-lock-tag')) {
          const header = block.querySelector('.round-header');
          if (header) {
            const lockTag = document.createElement('span');
            lockTag.className = 'round-lock-tag';
            lockTag.textContent = '🔒';
            header.appendChild(lockTag);
          }
        }
      }
    });

    // Final — só desbloqueia quando todas as rodadas concluídas
    const allRoundsDone = APP.matches
      .filter(x => x.phase === 'round')
      .every(x => x.sA !== null);
    const finalBlock = document.querySelector('#rounds-area .round-block[style*="244,192,38"]');
    if (finalBlock) {
      if (allRoundsDone) finalBlock.classList.remove('locked');
      else finalBlock.classList.add('locked');
    }
  }
}

// ── STANDINGS ────────────────────────────────────────────
function simWinner(mx){
  if(!mx||mx.sA===null||mx.sB===null||mx.sA===mx.sB) return null;
  return mx.sA>mx.sB?(mx.a||mx.teamA):(mx.b||mx.teamB);
}
// ── CLASSIFICAÇÃO COM DESEMPATE POR SETS ─────────────────
// Critérios em ordem:
//   Individual:    1º Vitórias  2º Sets ganhos  3º Saldo de sets (ganhados - sofridos)
//   Soma X:        1º Games     2º Vitórias
//   Duplas fixas:  1º Vitórias  2º Sets ganhos  3º Saldo de sets

function calcIndivStandings(players,rounds){
  const st={};
  // sets_w = sets ganhos (valor numérico do placar a favor)
  // sets_l = sets perdidos (valor numérico do placar contra)
  // saldo  = sets_w - sets_l (pode ser negativo, zero ou positivo)
  players.forEach(p=>{ st[p]={name:p,pts:0,v:0,j:0,sets_w:0,sets_l:0}; });
  rounds.forEach(mx=>{
    if(mx.sA===null||mx.sB===null) return;
    const pA=[mx.pA0,mx.pA1].filter(Boolean);
    const pB=[mx.pB0,mx.pB1].filter(Boolean);
    // Acumula sets ganhos e perdidos com o valor real do placar
    pA.forEach(p=>{if(st[p]){ st[p].j++; st[p].sets_w+=mx.sA; st[p].sets_l+=mx.sB; }});
    pB.forEach(p=>{if(st[p]){ st[p].j++; st[p].sets_w+=mx.sB; st[p].sets_l+=mx.sA; }});
    if(mx.sA>mx.sB)      pA.forEach(p=>{if(st[p]){st[p].pts++;st[p].v++;}});
    else if(mx.sB>mx.sA) pB.forEach(p=>{if(st[p]){st[p].pts++;st[p].v++;}});
  });
  return Object.values(st).sort((a,b)=>{
    // 1º: mais vitórias
    const byV = b.pts - a.pts;
    if(byV!==0) return byV;
    // 2º: melhor saldo (ganhos - perdidos) — pode ser negativo
    const saldoB = b.sets_w - b.sets_l;
    const saldoA = a.sets_w - a.sets_l;
    const bySaldo = saldoB - saldoA;
    if(bySaldo!==0) return bySaldo;
    // 3º: maior volume de sets ganhos
    return b.sets_w - a.sets_w;
  });
}

function calcSomaStandings(players,rounds){
  const st={};
  players.forEach(p=>{ st[p]={name:p,games:0,v:0,j:0}; });
  rounds.forEach(mx=>{
    if(mx.sA===null||mx.sB===null) return;
    const pA=[mx.pA0,mx.pA1].filter(Boolean);
    const pB=[mx.pB0,mx.pB1].filter(Boolean);
    pA.forEach(p=>{if(st[p]){ st[p].j++; st[p].games+=mx.sA; }});
    pB.forEach(p=>{if(st[p]){ st[p].j++; st[p].games+=mx.sB; }});
    if(mx.sA>mx.sB)      pA.forEach(p=>{if(st[p])st[p].v++;});
    else if(mx.sB>mx.sA) pB.forEach(p=>{if(st[p])st[p].v++;});
  });
  // Soma X: 1º games acumulados, 2º vitórias como desempate
  return Object.values(st).sort((a,b)=>
    (b.games - a.games) || (b.v - a.v)
  );
}

function calcDuplaStandings(names,matches){
  // Filtrar jogadores reais (excluir __BYE__)
  const realNames = names.filter(n=>n!=='__BYE__');
  const st={};
  realNames.forEach(n=>{ st[n]={name:n,v:0,d:0,j:0,gp:0,gc:0}; });

  matches.forEach(mx=>{
    // Match de bye: ignorado completamente no ranking
    if(mx.isBye) return;
    // Partida ainda não confirmada
    if(mx.sA===null||mx.sB===null) return;
    // Ignorar matches que envolvam __BYE__ (segurança)
    if(mx.a==='__BYE__'||mx.b==='__BYE__') return;

    const wn=simWinner(mx); if(!wn) return;
    const ln=wn===mx.a?mx.b:mx.a;
    // Segurança: ambas as duplas devem estar no standings
    if(!st[wn]||!st[ln]) return;

    const placarVenc=wn===mx.a?mx.sA:mx.sB;
    const placarPerd=wn===mx.a?mx.sB:mx.sA;
    st[wn].v++; st[wn].j++; st[wn].gp+=placarVenc; st[wn].gc+=placarPerd;
    st[ln].d++; st[ln].j++; st[ln].gp+=placarPerd; st[ln].gc+=placarVenc;
  });

  return Object.values(st).sort((a,b)=>{
    // 1º: mais vitórias
    const byV = b.v - a.v;
    if(byV!==0) return byV;
    // 2º: melhor saldo (ganhos - perdidos) — pode ser negativo
    const saldoB = b.gp - b.gc;
    const saldoA = a.gp - a.gc;
    const bySaldo = saldoB - saldoA;
    if(bySaldo!==0) return bySaldo;
    // 3º: maior volume de sets ganhos
    return b.gp - a.gp;
  });
}

function getStandings(){
  const m=APP.mode;
  const isDupla=IS_DUPLA_FIXA[m];
  const isSoma=IS_SOMA[m];
  const isElim=IS_ELIMINATORIO[m];

  // Eliminatória: ranking por resultado no bracket
  if(isElim){
    const allMatches=APP.matches.filter(x=>x.sA!==null&&x.b!=='');
    // Contar vitórias e derrotas no bracket
    const st={};
    APP.players.forEach(p=>{ st[p.name]={name:p.name,v:0,d:0,j:0,gp:0,gc:0}; });
    allMatches.forEach(mx=>{
      if(!mx.a||!mx.b||mx.sA===null) return;
      const wn=mx.sA>mx.sB?mx.a:mx.b;
      const ln=wn===mx.a?mx.b:mx.a;
      if(st[wn]){st[wn].v++;st[wn].j++;st[wn].gp+=Math.max(mx.sA,mx.sB);st[wn].gc+=Math.min(mx.sA,mx.sB);}
      if(st[ln]){st[ln].d++;st[ln].j++;st[ln].gp+=Math.min(mx.sA,mx.sB);st[ln].gc+=Math.max(mx.sA,mx.sB);}
    });
    return Object.values(st).sort((a,b)=>{
      const byV=b.v-a.v; if(byV!==0) return byV;
      const sA=(a.gp-a.gc),sB=(b.gp-b.gc);
      return sB-sA;
    }).map(p=>({...p,scoreLabel:p.v+' V',tieLabel:'saldo '+(p.gp-p.gc>0?'+'+(p.gp-p.gc):String(p.gp-p.gc)),saldo:p.gp-p.gc,scoreVal:p.v,isDupla:true}));
  }

  if(isDupla){
    const names=APP.players.filter(p=>!p.isBye).map(p=>p.name);
    const rr=APP.matches.filter(x=>x.phase==='rr');
    return calcDuplaStandings(names,rr).map(p=>{
      const saldo=p.gp-p.gc;
      const saldoStr=saldo>0?('+'+saldo):String(saldo);
      return {
        ...p,
        scoreLabel: p.v+' V',
        tieLabel: `${p.gp} sets · saldo ${saldoStr}`,
        saldo,
        scoreVal: p.v,
        isDupla: true
      };
    });
  }
  const ps=APP.players.map(p=>p.name);
  const rounds=APP.matches.filter(x=>x.phase==='round');
  if(isSoma) return calcSomaStandings(ps,rounds).map(p=>({
    ...p,
    scoreLabel: p.games+' games',
    scoreVal: p.games,
    isSoma: true
  }));
  return calcIndivStandings(ps,rounds).map(p=>{
    const saldo=p.sets_w-p.sets_l;
    const saldoStr=saldo>0?('+'+saldo):String(saldo);
    return {
      ...p,
      scoreLabel: p.pts+' pts',
      tieLabel: 'saldo '+saldoStr,
      saldo,
      scoreVal: p.pts
    };
  });
}

function trackTournamentFinishedOnce(stand, champ, isAutoOpen) {
  if (APP._trackedTournamentFinished) return;
  const rounds = APP.matches.filter(x =>
    (x.phase === 'round' || x.phase === 'rr' || x.phase === 'elim' || x.phase === 'final') && !x.isBye
  );
  const allDone = rounds.length > 0 && rounds.every(x => x.sA !== null);
  if (!allDone) return;

  APP._trackedTournamentFinished = true;
  const access = typeof currentAccess === 'function' ? currentAccess() : null;
  trackEvent('tournament_finished', {
    format: APP.mode || '',
    category: APP.category || '',
    players: (APP.players || []).filter(p => !p.isBye).length,
    plan: access?.plan || (APP.isGuest ? 'guest' : 'free'),
    auto_open: !!isAutoOpen,
    champion: stand?.[0]?.name || champ || '',
    top3: (stand || []).slice(0, 3).map(p => p.name)
  });
}

// ── FOOTER RANKING ────────────────────────────────────────
function updateFooterRanking(){
  const stand=getStandings();
  const medals=['🥇','🥈','🥉'];
  const posClass=['p1','p2','p3'];
  const list=document.getElementById('rank-mini-list');
  if(!list) return;
  // Mostrar TODOS os jogadores/duplas, não apenas os primeiros
  list.innerHTML=stand.map((p,i)=>{
    const hasTie = stand.some((q,j)=>j!==i && q.scoreVal===p.scoreVal);
    const tieSpan = (hasTie && p.tieLabel) ? `<span class="rank-tie">(${p.tieLabel})</span>` : '';
    return `<div class="rank-mini-item">
      <span class="rank-pos ${posClass[i]||''}">${medals[i]||i+1+'º'}</span>
      <span class="rank-name">${p.name}</span>
      ${tieSpan}
      <span class="rank-pts ${p.isSoma?'soma':''}">${p.scoreLabel}</span>
    </div>`;
  }).join('');
  // Rolar para o topo do ranking sempre que atualizar
  list.scrollTop = 0;
}

// ── RESULTADO FINAL ───────────────────────────────────────
function verResultadoFinal(isAutoOpen) {
  const stand=getStandings();
  const fn=APP.matches.find(x=>x.phase==='final');
  const champ=fn?simWinner(fn):null;
  const medals=['🥇','🥈','🥉'];
  const m=APP.mode;
  const isDupla=IS_DUPLA_FIXA[m];
  const isSoma=IS_SOMA[m];
  trackTournamentFinishedOnce(stand, champ, isAutoOpen);

  // Podium
  const top3=stand.slice(0,3);
  const podiumOrder=[1,0,2]; // 2º, 1º, 3º (visualmente)
  let podiumHTML=`<div class="podium-row">`;
  podiumOrder.forEach(idx=>{
    const p=top3[idx];
    if(!p) return;
    podiumHTML+=`<div class="podium-item">
      <div class="podium-place">${medals[idx]||idx+1+'º'}</div>
      <div class="podium-bar p${idx+1}"><span class="podium-medal">${medals[idx]||'🏅'}</span></div>
      <div class="podium-name">${p.name}</div>
      <div class="podium-pts">${p.scoreLabel}</div>
    </div>`;
  });
  podiumHTML+=`</div>`;

  // Table
  const ptsLabel = isSoma?'Games':isDupla?'Sets':'Pts';
  const rows=stand.map((p,i)=>`
    <tr class="${i<3?'r'+(i+1):''}">
      <td class="rn">${medals[i]||i+1+'º'}</td>
      <td style="font-weight:500">${p.name}</td>
      <td>${p.j}</td>
      <td>${p.v||0}</td>
      <td><span class="pts-chip ${p.isSoma?'soma':''}">${isDupla?(p.gp??0):p.scoreLabel.split(' ')[0]}</span></td>
      ${isDupla
        ? `<td style="color:var(--muted);font-size:12px">saldo ${p.saldo>=0?'+'+p.saldo:p.saldo}</td>`
        : (!isSoma&&p.tieLabel)?`<td style="color:var(--muted);font-size:12px">${p.tieLabel}</td>`:`<td></td>`
      }
    </tr>`).join('');

  const content=`
    <div class="podium-wrap">
      <div class="podium-title">${isAutoOpen?'🏆 Torneio Finalizado!':'Ranking'}</div>
      <div class="podium-sub">${MODE_INFO[m].label} · ${new Date().toLocaleDateString('pt-BR')}</div>
    </div>
    ${champ?`<div class="info-card" style="text-align:center;background:linear-gradient(135deg,rgba(244,192,38,0.15),rgba(13,74,107,0.3));border-color:rgba(244,192,38,0.4)">
      <div style="font-size:36px;margin-bottom:6px">🏆</div>
      <div style="font-family:'Bebas Neue';font-size:14px;color:var(--muted2);letter-spacing:2px">CAMPEÃO</div>
      <div style="font-family:'Bebas Neue';font-size:28px;color:var(--yellow-l);letter-spacing:1px">${champ}</div>
    </div>`:''}
    ${podiumHTML}
    <div class="accent-line"></div>
    <table class="full-rank-table">
      <thead><tr><th>#</th><th>Nome</th><th>J</th><th>V</th><th>${ptsLabel}</th><th style="color:var(--muted)">${isDupla?'Saldo':'Saldo'}</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  document.getElementById('resultado-content').innerHTML=content;
  document.getElementById('resultado-actions').innerHTML=`
    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="display:flex;gap:8px">
        <button class="share-btn-save" onclick="downloadPNG()" style="flex:1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Salvar Imagem
        </button>
        <button class="share-btn-send" onclick="nativeShare()" style="flex:1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Compartilhar
        </button>
      </div>
      <button class="btn btn-ghost btn-full" onclick="confirmNewTourney()">🔄 Novo Torneio</button>
    </div>
  `;
  // Garante que o canvas é gerado ao entrar na tela de resultado
  _canvasReady = generateShareCanvas().catch(()=>{});
  // Salva torneio no histórico se logado
  saveTournament();

  if(isAutoOpen) {
    // Pequeno delay para ter a sensação de conclusão
    setTimeout(()=>goTo('screen-resultado'), 600);
  } else {
    goTo('screen-resultado');
  }
}

function voltarParaCorrecao() {
  // Volta para tela de rodadas sem destruir o torneio
  // O botão no footer ficará destacado para voltar ao resultado
  APP._autoNavigateResult = false;
  goBack();
  // Após voltar, o updateSeeAllBtn vai mostrar o botão de ir ao resultado
  setTimeout(() => {
    updateFooterRanking();
    updateSeeAllBtn();
  }, 400);
}

function _doNewTourney(){
  APP.category=null; APP.mode=null; APP.players=[]; APP.matches=[];
  APP.fmt='rr'; APP.tourneyClosed=false;
  APP._savedCurrentTournament=false; APP._trackedTournamentFinished=false;
  APP.history=['screen-home'];
  document.querySelectorAll('.screen').forEach(s=>{ s.classList.remove('active','leaving'); s.style.transform=''; });
  document.getElementById('screen-home').classList.add('active');
}

function confirmNewTourney(){
  // Remove modal anterior se existir
  const old = document.getElementById('new-tourney-modal');
  if (old) old.remove();

  const isLogado = !!SUPA_USER;
  const modal = document.createElement('div');
  modal.id = 'new-tourney-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)';

  if (isLogado) {
    modal.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border2);border-radius:var(--radius);padding:28px 24px;max-width:340px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.5)">
      <div style="font-size:28px;text-align:center;margin-bottom:8px">✅</div>
      <div style="font-family:'Bebas Neue';font-size:20px;color:var(--white);text-align:center;letter-spacing:1px;margin-bottom:8px">Torneio salvo!</div>
      <div style="font-size:13px;color:var(--muted2);text-align:center;line-height:1.5;margin-bottom:20px">Este torneio ficou salvo no seu histórico. Você pode consultá-lo quando quiser em <b style="color:var(--white)">Meus Torneios</b>.</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button onclick="document.getElementById('new-tourney-modal').remove();_doNewTourney()" style="background:var(--blue);color:var(--white);border:none;border-radius:var(--radius-sm);padding:12px;font-family:'Bebas Neue';font-size:16px;letter-spacing:1px;cursor:pointer">NOVO TORNEIO</button>
        <button onclick="document.getElementById('new-tourney-modal').remove()" style="background:transparent;color:var(--muted2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;font-family:inherit;font-size:13px;cursor:pointer">Cancelar</button>
      </div>
    </div>`;
  } else {
    modal.innerHTML = `<div style="background:var(--surface);border:1px solid var(--border2);border-radius:var(--radius);padding:28px 24px;max-width:340px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.5)">
      <div style="font-size:28px;text-align:center;margin-bottom:8px">⚠️</div>
      <div style="font-family:'Bebas Neue';font-size:20px;color:var(--white);text-align:center;letter-spacing:1px;margin-bottom:8px">Torneio não salvo</div>
      <div style="font-size:13px;color:var(--muted2);text-align:center;line-height:1.5;margin-bottom:20px">Você não está logado — este torneio não ficou no histórico. Crie uma conta para não perder os próximos.</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button onclick="document.getElementById('new-tourney-modal').remove();openAuthModal('signup')" style="background:var(--yellow);color:#0a0a0a;border:none;border-radius:var(--radius-sm);padding:12px;font-family:'Bebas Neue';font-size:16px;letter-spacing:1px;cursor:pointer">CRIAR CONTA GRÁTIS</button>
        <button onclick="document.getElementById('new-tourney-modal').remove();_doNewTourney()" style="background:transparent;color:var(--muted2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;font-family:inherit;font-size:13px;cursor:pointer">Continuar sem salvar</button>
        <button onclick="document.getElementById('new-tourney-modal').remove()" style="background:transparent;color:var(--muted);border:none;padding:6px;font-family:inherit;font-size:12px;cursor:pointer">Cancelar</button>
      </div>
    </div>`;
  }
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
}
