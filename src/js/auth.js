// ═══════════════════════════════════════════════════════════
// SISTEMA DE AUTENTICAÇÃO — Supabase
// ═══════════════════════════════════════════════════════════
const BT8_ENV = window.BT8_ENV || {};
const SUPA_URL = BT8_ENV.SUPABASE_URL || 'https://znifpitysqfbepjymtmg.supabase.co';
const SUPA_KEY = BT8_ENV.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuaWZwaXR5c3FmYmVwanltdG1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNDM0MTMsImV4cCI6MjA5MjYxOTQxM30.zeX_H63t9mKFLb3nNDjw7efPZmzE87BzDqFPa0U_c_c';
let SUPA = null;
let SUPA_USER = null;

// Entra no sistema após login — mesmo padrão do _doNewTourney que funciona
function enterApp() {
  closeAuthModal();
  APP.isGuest = false;
  APP.history = ['screen-home'];
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active', 'leaving', 'back-entering');
    s.style.transform = '';
    s.style.transition = '';
  });
  document.getElementById('screen-home').classList.add('active');
  if (typeof updateGuestConversionUI === 'function') updateGuestConversionUI();
  if (typeof loadHomeHistory === 'function') {
    setTimeout(loadHomeHistory, 300);
  }
}

// ── SUPABASE INIT ────────────────────────────────────────────
function initSupabase() {
  try {
    SUPA = window.supabase.createClient(SUPA_URL, SUPA_KEY);
    SUPA.auth.onAuthStateChange((event, session) => {
      SUPA_USER = session?.user || null;
      handleAuthStateChange(SUPA_USER);
    });
    SUPA.auth.getSession().then(({ data }) => {
      SUPA_USER = data?.session?.user || null;
      handleAuthStateChange(SUPA_USER);
    });
  } catch(e) { console.warn('Supabase init error:', e); }
}

// ── AUTH STATE CHANGE ────────────────────────────────────────
// Única fonte de verdade para navegação pós-login.
function handleAuthStateChange(user) {
  const currentScreen = APP.history[APP.history.length - 1];
  const activeScreen = document.querySelector('.screen.active')?.id;
  const authModalOpen = document.getElementById('auth-modal')?.classList.contains('open');
  const updateAdminButton = (access) => {
    const adminBtn = document.getElementById('admin-menu-btn');
    if (adminBtn) adminBtn.style.display = (access?.isAdmin || user?.email === ADMIN_EMAIL) ? '' : 'none';
  };

  // Logou pela landing ou pelo modal → entra no app mesmo se o histórico interno estiver defasado.
  if (user && (currentScreen === 'screen-landing' || activeScreen === 'screen-landing' || authModalOpen)) {
    enterApp();
  }
  if (user) APP.isGuest = false;
  if (typeof updateGuestConversionUI === 'function') updateGuestConversionUI();
  if (typeof refreshAccess === 'function') {
    refreshAccess(user).then(access => {
      updateAdminButton(access);
      if (typeof renderPlanSurfaces === 'function') renderPlanSurfaces(access);
      if (user) buildUserMenu(user);
      if (typeof handleCheckoutReturn === 'function') handleCheckoutReturn();
    });
  }

  // Mostrar/ocultar botão admin
  setTimeout(() => {
    updateAdminButton(typeof currentAccess === 'function' ? currentAccess() : null);
  }, 100);

  // Atualiza UI do topbar
  const wrap = document.getElementById('auth-wrap');
  if (!wrap) return;
  if (user) {
    renderUserAvatar(user);
    buildUserMenu(user);
  } else {
    const btn = document.getElementById('auth-btn');
    if (btn) { btn.innerHTML = '👤'; btn.style.background = ''; btn.style.padding = ''; }
    buildGuestMenu();
  }
}

function renderUserAvatar(user) {
  const btn = document.getElementById('auth-btn');
  if (!btn) return;
  const avatarUrl = user.user_metadata?.avatar_url || user.user_metadata?.picture;
  const name = user.user_metadata?.full_name || user.user_metadata?.name || user.email;
  if (avatarUrl) {
    btn.innerHTML = `<img src="${avatarUrl}" alt="avatar">`;
  } else {
    const initials = name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : '?';
    btn.innerHTML = `<span style="font-size:13px;font-weight:700;font-family:'Barlow Condensed';letter-spacing:1px">${initials}</span>`;
    btn.style.background = 'var(--blue)';
  }
}

// ── AUTH MODAL ───────────────────────────────────────────────
function openAuthModal(tab) {
  closeUserMenu();
  // Rola a landing para o topo para que o modal fique visível
  const landing = document.getElementById('lp-main') || document.getElementById('screen-landing');
  if (landing) landing.scrollTo({ top: 0, behavior: 'smooth' });
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.add('open');
  switchAuthTab(tab || 'login');
  clearAuthMsg();
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (modal) { modal.classList.remove('open'); clearAuthMsg(); }
}

document.addEventListener('click', function(e) {
  const modal = document.getElementById('auth-modal');
  if (modal && modal.classList.contains('open') && e.target === modal) closeAuthModal();
});

function switchAuthTab(tab) {
  const tabLogin = document.getElementById('tab-login');
  const tabSignup = document.getElementById('tab-signup');
  const fLogin = document.getElementById('form-login');
  const fSignup = document.getElementById('form-signup');
  const fForgot = document.getElementById('form-forgot');
  clearAuthMsg();
  if (tab === 'login') {
    tabLogin && tabLogin.classList.add('active');
    tabSignup && tabSignup.classList.remove('active');
    if (fLogin) fLogin.style.display = '';
    if (fSignup) fSignup.style.display = 'none';
    if (fForgot) fForgot.style.display = 'none';
  } else if (tab === 'signup') {
    tabLogin && tabLogin.classList.remove('active');
    tabSignup && tabSignup.classList.add('active');
    if (fLogin) fLogin.style.display = 'none';
    if (fSignup) fSignup.style.display = '';
    if (fForgot) fForgot.style.display = 'none';
  }
}

function showForgot() {
  const fLogin = document.getElementById('form-login');
  const fForgot = document.getElementById('form-forgot');
  const tabLogin = document.getElementById('tab-login');
  const tabSignup = document.getElementById('tab-signup');
  if (fLogin) fLogin.style.display = 'none';
  if (fForgot) fForgot.style.display = '';
  if (tabLogin) tabLogin.classList.remove('active');
  if (tabSignup) tabSignup.classList.remove('active');
  clearAuthMsg();
}

function clearAuthMsg() {
  const m = document.getElementById('auth-msg');
  if (m) { m.className = 'auth-msg'; m.textContent = ''; }
}

function showAuthMsg(text, type) {
  const m = document.getElementById('auth-msg');
  if (!m) return;
  m.className = 'auth-msg ' + type;
  m.textContent = text;
}

function checkPw(pw) {
  const okLen = pw.length >= 8;
  const okLetter = /[a-zA-Z]/.test(pw);
  const okNum = /[0-9]/.test(pw);
  const el = (id, ok) => { const e = document.getElementById(id); if (e) e.className = 'pw-check' + (ok ? ' ok' : ''); };
  el('pwc-len', okLen); el('pwc-letter', okLetter); el('pwc-num', okNum);
  return okLen && okLetter && okNum;
}

// ── LOGIN / SIGNUP / LOGOUT ──────────────────────────────────
async function loginWithGoogle() {
  if (!SUPA) return showAuthMsg('Serviço indisponível', 'error');
  try {
    const { error } = await SUPA.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    });
    if (error) showAuthMsg(error.message, 'error');
  } catch(e) { showAuthMsg('Erro ao conectar com Google', 'error'); }
}

async function doLogin() {
  if (!SUPA) return showAuthMsg('Serviço indisponível', 'error');
  const email = document.getElementById('login-email')?.value?.trim();
  const pw = document.getElementById('login-pw')?.value;
  if (!email || !pw) return showAuthMsg('Preencha e-mail e senha', 'error');
  const btn = document.querySelector('#form-login .btn-auth-submit');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    const { error } = await SUPA.auth.signInWithPassword({ email, password: pw });
    // Navegação tratada pelo handleAuthStateChange via onAuthStateChange
    if (error) showAuthMsg(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos' : error.message, 'error');
  } catch(e) { showAuthMsg('Erro ao conectar', 'error'); }
  if (btn) { btn.disabled = false; btn.textContent = 'ENTRAR'; }
}

async function doSignup() {
  if (!SUPA) return showAuthMsg('Serviço indisponível', 'error');
  const name = document.getElementById('signup-name')?.value?.trim();
  const email = document.getElementById('signup-email')?.value?.trim();
  const pw = document.getElementById('signup-pw')?.value;
  if (!name || name.length < 3) return showAuthMsg('Nome deve ter pelo menos 3 caracteres', 'error');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showAuthMsg('E-mail inválido', 'error');
  if (!checkPw(pw)) return showAuthMsg('Senha não atende os requisitos', 'error');
  const btn = document.querySelector('#form-signup .btn-auth-submit');
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  try {
    const { data, error } = await SUPA.auth.signUp({
      email, password: pw,
      options: { data: { full_name: name } }
    });
    if (error) { showAuthMsg(error.message, 'error'); }
    else if (data?.user?.identities?.length === 0) {
      showAuthMsg('E-mail já cadastrado. Faça login.', 'error');
      setTimeout(() => switchAuthTab('login'), 2000);
    } else {
      showAuthMsg('Conta criada! Verifique seu e-mail para confirmar.', 'success');
    }
  } catch(e) { showAuthMsg('Erro ao criar conta', 'error'); }
  if (btn) { btn.disabled = false; btn.textContent = 'CADASTRAR'; }
}

async function doForgot() {
  if (!SUPA) return showAuthMsg('Serviço indisponível', 'error');
  const email = document.getElementById('forgot-email')?.value?.trim();
  if (!email) return showAuthMsg('Informe seu e-mail', 'error');
  try {
    const { error } = await SUPA.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) showAuthMsg(error.message, 'error');
    else showAuthMsg('Link enviado! Verifique sua caixa de entrada.', 'success');
  } catch(e) { showAuthMsg('Erro ao enviar link', 'error'); }
}

async function logoutUser() {
  closeUserMenu();
  if (SUPA) await SUPA.auth.signOut();
  APP.isGuest = false;
  APP.history = ['screen-landing'];
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active', 'leaving', 'back-entering');
    s.style.transform = '';
    s.style.transition = '';
  });
  document.getElementById('screen-landing').classList.add('active');
  if (typeof updateGuestConversionUI === 'function') updateGuestConversionUI();
  const hEl = document.getElementById('home-history');
  if (hEl) { hEl.innerHTML = ''; hEl.style.display = 'none'; }
}

// ── LANDING — sem login ──────────────────────────────────────
function startWithoutLogin() {
  APP.isGuest = true;
  APP.history = ['screen-home'];
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active', 'leaving', 'back-entering');
    s.style.transform = '';
    s.style.transition = '';
  });
  document.getElementById('screen-home').classList.add('active');
  if (typeof buildGuestMenu === 'function') buildGuestMenu();
  if (typeof updateGuestConversionUI === 'function') updateGuestConversionUI();
  if (typeof renderGuestHistoryPreview === 'function') renderGuestHistoryPreview();
}

// ── LANDING — funções LP (inline form, mantidas para compatibilidade) ─
function lpSwitchTab(tab) {
  const fLogin = document.getElementById('lp-form-login');
  const fSignup = document.getElementById('lp-form-signup');
  const tLogin = document.getElementById('lp-tab-login');
  const tSignup = document.getElementById('lp-tab-signup');
  lpClearMsg();
  if (tab === 'login') {
    if (fLogin) fLogin.style.display = ''; if (fSignup) fSignup.style.display = 'none';
    tLogin && tLogin.classList.add('active'); tSignup && tSignup.classList.remove('active');
  } else {
    if (fLogin) fLogin.style.display = 'none'; if (fSignup) fSignup.style.display = '';
    tLogin && tLogin.classList.remove('active'); tSignup && tSignup.classList.add('active');
  }
}
function lpShowMsg(msg, type) {
  const el = document.getElementById('lp-auth-msg');
  if (el) { el.textContent = msg; el.className = 'lp-auth-msg ' + (type || ''); }
}
function lpClearMsg() {
  const el = document.getElementById('lp-auth-msg');
  if (el) { el.textContent = ''; el.className = 'lp-auth-msg'; }
}
async function lpLoginGoogle() { return loginWithGoogle(); }
async function lpLogin() {
  if (!SUPA) return lpShowMsg('Serviço indisponível', 'error');
  const email = document.getElementById('lp-email')?.value?.trim();
  const pw = document.getElementById('lp-pw')?.value;
  if (!email || !pw) return lpShowMsg('Preencha e-mail e senha', 'error');
  const { error } = await SUPA.auth.signInWithPassword({ email, password: pw }).catch(() => ({ error: { message: 'Erro' } }));
  if (error) lpShowMsg(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos' : error.message, 'error');
}
async function lpSignup() {
  if (!SUPA) return lpShowMsg('Serviço indisponível', 'error');
  const name = document.getElementById('lp-signup-name')?.value?.trim();
  const email = document.getElementById('lp-signup-email')?.value?.trim();
  const pw = document.getElementById('lp-signup-pw')?.value;
  if (!name || name.length < 3) return lpShowMsg('Nome deve ter pelo menos 3 caracteres', 'error');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return lpShowMsg('E-mail inválido', 'error');
  if (!checkPw(pw)) return lpShowMsg('Senha não atende os requisitos', 'error');
  const { data, error } = await SUPA.auth.signUp({ email, password: pw, options: { data: { full_name: name } } }).catch(() => ({ error: { message: 'Erro' } }));
  if (error) lpShowMsg(error.message, 'error');
  else if (data?.user?.identities?.length === 0) { lpShowMsg('E-mail já cadastrado. Faça login.', 'error'); setTimeout(() => lpSwitchTab('login'), 2000); }
  else lpShowMsg('Conta criada! Verifique seu e-mail para confirmar.', 'success');
}
async function lpForgot() {
  if (!SUPA) return lpShowMsg('Serviço indisponível', 'error');
  const email = document.getElementById('lp-email')?.value?.trim();
  if (!email) return lpShowMsg('Informe seu e-mail acima', 'error');
  const { error } = await SUPA.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }).catch(() => ({ error: { message: 'Erro' } }));
  if (error) lpShowMsg(error.message, 'error');
  else lpShowMsg('Link enviado! Verifique sua caixa de entrada.', 'success');
}

// ── LANDING OBSERVER (fade-in) ───────────────────────────────
function initLandingObserver() {
  const screen = document.getElementById('screen-landing');
  const scrollRoot = document.getElementById('lp-main') || screen;
  if (!screen || !scrollRoot) return;
  document.querySelectorAll('.lp-s.visible-init').forEach(el => el.classList.add('visible'));
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll('.lp-s').forEach(el => el.classList.add('visible'));
    return;
  }
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
  }, { root: scrollRoot, threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.lp-s:not(.visible-init)').forEach(el => obs.observe(el));
}

function initStickyCtaObserver() {
  const screen = document.getElementById('screen-landing');
  const scrollRoot = document.getElementById('lp-main') || screen;
  const sticky = document.getElementById('lp-sticky');
  const finalCta = document.getElementById('lp-cta-final');
  if (!screen || !scrollRoot || !sticky || !finalCta || !('IntersectionObserver' in window)) return;

  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      sticky.classList.toggle('is-hidden', entry.isIntersecting);
    });
  }, { root: scrollRoot, threshold: 0.28 });

  obs.observe(finalCta);
}

// ── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSupabase();
  initLandingObserver();
  initStickyCtaObserver();
  // Copia logo do screen-home para a landing (evita duplicar base64)
  const appLogo = document.querySelector('#screen-home .topbar-logo');
  if (appLogo) {
    const src = appLogo.src;
    ['lp-logo', 'lp-nav-logo'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.src = src;
    });
  }
});
