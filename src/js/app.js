// ══════════════════════════════════════════════════
// APP — State, Navigation, Menus, Perfil, PWA (Admin fica em admin.js)
// ══════════════════════════════════════════════════

function buildUserMenu(user) {
  const menu = document.getElementById('user-menu');
  if (!menu) return;
  const name = user.user_metadata?.full_name || user.user_metadata?.name || 'Usuário';
  const access = typeof currentAccess === 'function' ? currentAccess() : null;
  const planCard = typeof planCardHtml === 'function' ? planCardHtml(access, 'menu') : '';
  const showPlanItem = !access?.isAdmin;
  const planItemLabel = access?.isPro ? icon('star') + ' Meu plano Pro' : icon('star') + ' Planos BT8 Pro';
  menu.innerHTML = `
    <div class="user-menu-name">${escapeHtml(name)}</div>
    <div class="user-menu-email">${escapeHtml(user.email)}</div>
    ${planCard}
    <div class="user-menu-item" onclick="openProfileModal()">${icon('user')} Meu Perfil</div>
    ${showPlanItem ? `<div class="user-menu-item" onclick="closeUserMenu();openPlansModal()">${planItemLabel}</div>` : ''}
    <div class="user-menu-item" onclick="closeUserMenu();openHistorico()">${icon('ball')} Meus Torneios</div>
    ${typeof isArenaMember === 'function' && isArenaMember() ? `<div class="user-menu-item" id="arena-menu-btn" onclick="openMinhaArena()">${icon('trophy')} Minha arena</div>` : ''}
    <div class="user-menu-item" id="admin-menu-btn" onclick="openAdminRoute()" style="${access?.isAdmin ? '' : 'display:none;'}">${icon('shield')} Admin</div>
    <div class="user-menu-item danger" onclick="logoutUser()">${icon('logout')} Sair</div>
  `;
}

function buildGuestMenu() {
  const menu = document.getElementById('user-menu');
  if (!menu) return;
  menu.innerHTML = `
    <div class="user-menu-item" onclick="openAuthModal('login')">Entrar</div>
    <div class="user-menu-item" onclick="openAuthModal('signup')">Criar conta</div>
  `;
}

function toggleUserMenu() {
  const menu = document.getElementById('user-menu');
  if (!menu) return;
  if (menu.classList.contains('open')) {
    menu.classList.remove('open');
    document.removeEventListener('click', closeMenuOutside);
  } else {
    menu.classList.add('open');
    setTimeout(() => document.addEventListener('click', closeMenuOutside), 50);
  }
}

function closeMenuOutside(e) {
  const wrap = document.getElementById('auth-wrap');
  if (wrap && !wrap.contains(e.target)) closeUserMenu();
}

function closeUserMenu() {
  const menu = document.getElementById('user-menu');
  if (menu) menu.classList.remove('open');
  document.removeEventListener('click', closeMenuOutside);
}


// ── STATE ───────────────────────────────────────────────
const APP = {
  category: null,   // 'individual' | 'duplas'
  mode: null,       // 's4','s6'...
  fmt: 'rr',        // 'rr' | 'final' | 'semi'
  idaVolta: false,  // true = cada dupla joga contra todas 2x
  players: [],      // [{name, gender?}]
  matches: [],
  history: ['screen-landing'],
  tourneyClosed: false,
  isGuest: false,
  _savedCurrentTournament: false,
  _trackedTournamentFinished: false,
};

// ── NAVIGATION ──────────────────────────────────────────
function goTo(id, addHistory=true) {
  const current = APP.history[APP.history.length-1];
  if(current === id) return;
  const curr = document.getElementById(current);
  const next = document.getElementById(id);
  if (!curr || !next) return;
  curr.classList.add('leaving');
  next.classList.remove('back-entering');
  next.classList.add('active');
  setTimeout(()=>{ curr.classList.remove('active','leaving'); }, 380);
  if(addHistory) APP.history.push(id);
}
function goBack() {
  if(APP.history.length < 2) return;
  APP.history.pop();
  const prev = APP.history[APP.history.length-1];
  const curr = document.querySelector('.screen.active');
  const prevEl = document.getElementById(prev);
  curr.style.transition='transform 0.32s cubic-bezier(0.4,0,0.2,1)';
  curr.style.transform='translateX(100%)';
  prevEl.classList.remove('leaving');
  prevEl.classList.add('active');
  setTimeout(()=>{ curr.classList.remove('active'); curr.style.transform=''; curr.style.transition=''; },320);
}

// ── SCREEN 1 → 2: CATEGORY ─────────────────────────────

// ══ ETAPA 2: PERFIL DO USUÁRIO ══════════════════════════════
let PROFILE_AVATAR_URL = '';

const BRAZIL_STATE_CODES = new Set([
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
]);

function splitSavedCityState(city, state) {
  const savedCity = String(city || '').trim();
  const savedState = String(state || '').trim().toUpperCase();
  if (BRAZIL_STATE_CODES.has(savedState)) {
    return { city: savedCity, state: savedState };
  }
  const match = savedCity.match(/^(.*?)\s*[-/]\s*([A-Za-z]{2})$/);
  if (match) {
    const parsedState = match[2].toUpperCase();
    if (BRAZIL_STATE_CODES.has(parsedState)) {
      return { city: match[1].trim(), state: parsedState };
    }
  }
  return { city: savedCity, state: '' };
}

async function openProfileModal() {
  closeUserMenu();
  document.getElementById('profile-modal').classList.add('open');
  // Carregar perfil
  await loadProfile();
}
function closeProfileModal() {
  document.getElementById('profile-modal').classList.remove('open');
}
async function loadProfile() {
  if (!SUPA || !SUPA_USER) return;
  const msg = document.getElementById('profile-msg');
  const avatarWrap = document.getElementById('profile-avatar-wrap');
  if (typeof refreshAccess === 'function') {
    const access = await refreshAccess(SUPA_USER);
    if (typeof renderPlanSurfaces === 'function') renderPlanSurfaces(access);
    if (typeof buildUserMenu === 'function') buildUserMenu(SUPA_USER);
  }
  // Avatar
  PROFILE_AVATAR_URL = SUPA_USER.user_metadata?.avatar_url || SUPA_USER.user_metadata?.picture || '';
  const avatar = PROFILE_AVATAR_URL;
  const name = SUPA_USER.user_metadata?.full_name || SUPA_USER.email?.split('@')[0] || 'BT8';
  renderProfileAvatar(avatar, name);
  const fileInput = document.getElementById('pf-avatar-file');
  if (fileInput) fileInput.value = '';
  if (msg) { msg.textContent = ''; msg.className = 'profile-msg'; }
  // Tentar buscar perfil salvo
  try {
    const { data, error } = await SUPA
      .from('profiles')
      .select('*')
      .eq('id', SUPA_USER.id)
      .maybeSingle();
    if (error) throw error;
    const profileName = data?.nome || name;
    PROFILE_AVATAR_URL = data?.avatar_url || PROFILE_AVATAR_URL;
    renderProfileAvatar(PROFILE_AVATAR_URL, profileName);
    if (data) {
      document.getElementById('pf-name').value  = profileName;
      document.getElementById('pf-phone').value = data.telefone || '';
      document.getElementById('pf-birth').value = data.data_nascimento || '';
      document.getElementById('pf-gender').value= data.sexo   || '';
      const location = splitSavedCityState(data.cidade, data.estado);
      document.getElementById('pf-city').value = location.city;
      document.getElementById('pf-state').value = location.state;
    } else {
      document.getElementById('pf-name').value = profileName;
    }
  } catch(e) {
    // Tabela pode não existir ainda — preencher com dados do auth
    document.getElementById('pf-name').value = name;
  }
}

function renderProfileAvatar(avatar, name) {
  const avatarWrap = document.getElementById('profile-avatar-wrap');
  if (!avatarWrap) return;
  if (avatar) {
    avatarWrap.innerHTML = `<img src="${escapeHtml(avatar)}" class="profile-avatar" alt="avatar">`;
  } else {
    avatarWrap.innerHTML = `<div class="profile-avatar-placeholder">${escapeHtml((name || 'B').charAt(0).toUpperCase())}</div>`;
  }
}

function handleProfileAvatarFile(event) {
  const file = event.target.files?.[0];
  const msg = document.getElementById('profile-msg');
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    if (msg) { msg.textContent = 'Escolha uma imagem válida.'; msg.className = 'profile-msg err'; }
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    if (msg) { msg.textContent = 'Use uma imagem de até 5 MB.'; msg.className = 'profile-msg err'; }
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      PROFILE_AVATAR_URL = canvas.toDataURL('image/jpeg', 0.82);
      const name = document.getElementById('pf-name')?.value || SUPA_USER?.email || 'BT8';
      renderProfileAvatar(PROFILE_AVATAR_URL, name);
      if (msg) { msg.textContent = 'Avatar pronto. Clique em salvar perfil.'; msg.className = 'profile-msg ok'; }
    };
    img.onerror = () => {
      if (msg) { msg.textContent = 'Não foi possível carregar essa imagem.'; msg.className = 'profile-msg err'; }
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function clearProfileAvatar() {
  PROFILE_AVATAR_URL = '';
  const fileInput = document.getElementById('pf-avatar-file');
  if (fileInput) fileInput.value = '';
  const name = document.getElementById('pf-name')?.value || SUPA_USER?.email || 'BT8';
  renderProfileAvatar('', name);
}
async function saveProfile() {
  if (!SUPA || !SUPA_USER) return;
  const btn = document.getElementById('btn-pf-save');
  const msg = document.getElementById('profile-msg');
  btn.disabled = true; btn.textContent = 'SALVANDO...';
  msg.textContent = ''; msg.className = 'profile-msg';
  const cityRaw = document.getElementById('pf-city').value.trim();
  const stateRaw = document.getElementById('pf-state')?.value || '';
  const payload = {
    id: SUPA_USER.id,
    email: SUPA_USER.email,
    nome:             document.getElementById('pf-name').value.trim(),
    telefone:         document.getElementById('pf-phone').value.trim(),
    data_nascimento:  document.getElementById('pf-birth').value || null,
    sexo:             document.getElementById('pf-gender').value || null,
    cidade:           cityRaw || null,
    estado:           stateRaw || null,
    avatar_url:       PROFILE_AVATAR_URL || null,
    updated_at: new Date().toISOString()
  };
  try {
    const currentMeta = SUPA_USER.user_metadata || {};
    const nextMeta = {
      ...currentMeta,
      full_name: payload.nome || currentMeta.full_name || currentMeta.name || SUPA_USER.email,
      avatar_url: PROFILE_AVATAR_URL || null
    };
    const { data: authData, error: authError } = await SUPA.auth.updateUser({ data: nextMeta });
    if (authError) throw authError;
    if (authData?.user) SUPA_USER = authData.user;

    let { error } = await SUPA
      .from('profiles')
      .upsert(payload, { onConflict: 'id' });
    if (error && /avatar_url|schema cache|column/i.test(error.message || '')) {
      delete payload.avatar_url;
      const retry = await SUPA
        .from('profiles')
        .upsert(payload, { onConflict: 'id' });
      error = retry.error;
    }
    if (error) throw error;
    if (typeof renderUserAvatar === 'function') renderUserAvatar(SUPA_USER);
    msg.textContent = 'Perfil salvo com sucesso';
    msg.className = 'profile-msg ok';
    setTimeout(() => { msg.textContent = ''; }, 3000);
  } catch(e) {
    msg.textContent = (e.message || 'Erro ao salvar');
    msg.className = 'profile-msg err';
  }
  btn.disabled = false; btn.textContent = 'SALVAR PERFIL';
}

function deleteAccountWarningCopy(access) {
  if (access?.isAdmin) {
    return {
      title: 'Conta Admin protegida',
      body: 'Esta conta tem acesso administrativo e não pode ser excluída pelo app. Remova o acesso manualmente no painel administrativo se isso for realmente necessário.',
      pro: false
    };
  }
  if (access?.isPro || access?.proExpired || access?.subscriptionStatus) {
    return {
      title: 'Excluir conta encerra seu acesso Pro',
      body: 'Seu direito de uso do BT8 Pro está ligado diretamente a esta conta. Ao excluir, você perde o acesso imediatamente, mesmo que ainda exista tempo pago restante. Se criar outra conta depois, o Pro não será transferido automaticamente. Se houver mensalidade recorrente, a cobrança futura será cancelada junto com a exclusão.',
      pro: true
    };
  }
  return {
    title: 'Excluir sua conta Free',
    body: 'Sua conta será excluída permanentemente, junto com perfil e torneios salvos. Essa ação não pode ser desfeita.',
    pro: false
  };
}

function updateDeleteAccountConfirmState() {
  const input = document.getElementById('delete-account-confirm');
  const btn = document.getElementById('delete-account-submit');
  if (btn) btn.disabled = (input?.value || '').trim().toUpperCase() !== 'EXCLUIR';
}

function closeDeleteAccountModal() {
  document.getElementById('delete-account-modal')?.remove();
}

function openDeleteAccountModal() {
  if (!SUPA || !SUPA_USER) return openAuthModal('login');
  const access = typeof currentAccess === 'function' ? currentAccess() : null;
  const copy = deleteAccountWarningCopy(access);
  const existing = document.getElementById('delete-account-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'delete-account-modal';
  modal.className = 'delete-account-modal';
  modal.innerHTML = `
    <div class="delete-account-card">
      <button class="delete-account-close" type="button" onclick="closeDeleteAccountModal()">x</button>
      <div class="delete-account-kicker">${copy.pro ? 'Plano Pro' : access?.isAdmin ? 'Admin' : 'Conta'}</div>
      <h3>${copy.title}</h3>
      <p>${copy.body}</p>
      ${access?.isAdmin ? '' : `
        <div class="delete-account-confirm-box">
          <label>Digite EXCLUIR para confirmar</label>
          <input id="delete-account-confirm" type="text" autocomplete="off" oninput="updateDeleteAccountConfirmState()" placeholder="EXCLUIR">
        </div>
        <button id="delete-account-submit" class="delete-account-submit" type="button" onclick="deleteAccount()" disabled>
          Excluir minha conta permanentemente
        </button>
      `}
      <button class="delete-account-cancel" type="button" onclick="closeDeleteAccountModal()">Manter minha conta</button>
      <div id="delete-account-msg" class="delete-account-msg"></div>
    </div>
  `;
  document.body.appendChild(modal);
  document.getElementById('delete-account-confirm')?.focus();
}

async function deleteAccount() {
  if (!SUPA || !SUPA_USER) return openAuthModal('login');
  const confirm = (document.getElementById('delete-account-confirm')?.value || '').trim().toUpperCase();
  const msg = document.getElementById('delete-account-msg');
  const btn = document.getElementById('delete-account-submit');
  if (confirm !== 'EXCLUIR') {
    if (msg) {
      msg.className = 'delete-account-msg err';
      msg.textContent = 'Digite EXCLUIR para confirmar.';
    }
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Excluindo conta...';
  }
  if (msg) {
    msg.className = 'delete-account-msg';
    msg.textContent = 'Cancelando cobranças recorrentes e removendo a conta com segurança...';
  }

  try {
    const { data: sessionData } = await SUPA.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Faça login novamente para continuar.');

    const response = await fetch('/.netlify/functions/delete-account', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ confirmation: confirm })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Não foi possível excluir a conta.');

    if (msg) {
      msg.className = 'delete-account-msg ok';
      msg.textContent = 'Conta excluida. Redirecionando...';
    }
    if (typeof forgetUserTournament === 'function') forgetUserTournament(SUPA_USER?.id, { ask: false });
    await SUPA.auth.signOut().catch(() => {});
    localStorage.removeItem(CHECKOUT_INTENT_KEY);
    sessionStorage.clear();
    setTimeout(() => {
      window.location.href = '/?account=deleted';
    }, 700);
  } catch (e) {
    if (msg) {
      msg.className = 'delete-account-msg err';
      msg.textContent = e.message || 'Erro ao excluir conta.';
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Excluir minha conta permanentemente';
    }
  }
}

// ══ ETAPA 3: RASTREAMENTO DE EVENTOS ════════════════════════
// Salva evento de uso no Supabase (torneio criado, finalizado, etc.)
async function trackEvent(type, details) {
  if (!SUPA) return; // Silencioso quando não há Supabase
  const payload = {
    user_id: SUPA_USER?.id || null,
    event_type: type,
    metadata: details || {},
    created_at: new Date().toISOString()
  };
  try {
    const { error } = await SUPA.from('app_events').insert(payload);
    if (error) throw error;
  } catch(e) {
    try {
      await SUPA.from('events').insert({
        user_id: payload.user_id,
        event_type: payload.event_type,
        details: payload.metadata,
        created_at: payload.created_at
      });
    } catch(_) {
      // Silencioso — não interrompe o fluxo do app
    }
  }
}

// ══ PWA: Service Worker + Banner iOS ══════════════════════
// Registrar SW apenas em HTTPS (Netlify/servidor) — silencioso em file://
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js', {scope: './'})
    .then(r => console.log('BT8 SW registrado'))
    .catch(() => {}); // silencioso — não é crítico
}

// Banner de instalação iOS (só aparece no Safari iOS fora do standalone)
(function() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true;
  const dismissed = localStorage.getItem('bt8-install-dismissed');
  if (!isIOS || isStandalone || dismissed) return;
  setTimeout(() => {
    const d = document.createElement('div');
    d.innerHTML = `<div style="
      position:fixed;bottom:0;left:0;right:0;z-index:9999;
      background:linear-gradient(to top,#0d1a27,#122030);
      border-top:1px solid rgba(26,127,196,0.35);
      padding:14px 16px calc(14px + env(safe-area-inset-bottom,0px));
      display:flex;align-items:center;gap:12px;
      box-shadow:0 -8px 32px rgba(0,0,0,0.5);
      animation:slideUp .35s ease" id="ios-banner">
      <style>@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}</style>
      <img src="data:image/png;base64,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" style="width:44px;height:44px;border-radius:10px;flex-shrink:0">
      <div style="flex:1">
        <div style="font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:1px;color:#ffd84d">INSTALAR BT8</div>
        <div style="font-size:11px;color:#7aa8c4;margin-top:2px;line-height:1.5">
          Toque em <strong style="color:#fff">${icon('share')} Compartilhar</strong> e depois <strong style="color:#fff">Adicionar à Tela de Início</strong>
        </div>
      </div>
      <button onclick="document.getElementById('ios-banner').remove();localStorage.setItem('bt8-install-dismissed','1')"
        style="background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);
        border-radius:8px;color:#7aa8c4;font-size:18px;width:32px;height:32px;
        cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0">✕</button>
    </div>`;
    document.body.appendChild(d);
  }, 2500);
})();

// ══ MÓDULO ARENA: rotas /arena, /scout, /telao/<slug>, /c/<slug>, /inscricao/<token>, /acompanhar/<token> ══
// Cada rota abre sua tela e chama a função de entrada do módulo, se ela já existir.
const ARENA_ROUTES = {
  arena: ['screen-arena', 'openArenaRoute'],
  scout: ['screen-scout', 'openScoutRoute'],
  telao: ['screen-telao', 'openTelaoRoute'],
  c: ['screen-publico', 'openPublicoRoute'],
  inscricao: ['screen-inscricao', 'openInscricaoRoute'],
  acompanhar: ['screen-acompanhar', 'openAcompanharRoute'],
};

function arenaRoute() {
  const m = window.location.pathname.replace(/\/+$/, '').match(/^\/(arena|scout|telao|c|inscricao|acompanhar)(?:\/([^/]+))?$/);
  if (!m || (!m[2] && !['arena', 'scout'].includes(m[1]))) return null; // telão, público, inscrição e acompanhamento exigem slug ou token
  return { name: m[1], param: m[2] || '' };
}

document.addEventListener('DOMContentLoaded', () => {
  const route = arenaRoute();
  if (!route) return;
  const [screenId, entry] = ARENA_ROUTES[route.name];
  document.querySelectorAll('.screen.active').forEach(el => el.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
  APP.history = [screenId];
  if (typeof window[entry] === 'function') window[entry](route.param);
});
