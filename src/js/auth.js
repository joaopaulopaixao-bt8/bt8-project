// ═══════════════════════════════════════════════════════════
// SISTEMA DE AUTENTICAÇÃO — Supabase
// ═══════════════════════════════════════════════════════════
const BT8_ENV = window.BT8_ENV || {};
const SUPA_URL = BT8_ENV.SUPABASE_URL || 'https://znifpitysqfbepjymtmg.supabase.co';
const SUPA_KEY = BT8_ENV.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuaWZwaXR5c3FmYmVwanltdG1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNDM0MTMsImV4cCI6MjA5MjYxOTQxM30.zeX_H63t9mKFLb3nNDjw7efPZmzE87BzDqFPa0U_c_c';
let SUPA = null;
let SUPA_USER = null;
let PASSWORD_RECOVERY_ACTIVE = false;

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
    if (typeof isAdminRoute === 'function' && isAdminRoute() && typeof showAdminRouteLoading === 'function') {
      showAdminRouteLoading();
    }
    SUPA = window.supabase.createClient(SUPA_URL, SUPA_KEY);
    SUPA.auth.onAuthStateChange((event, session) => {
      SUPA_USER = session?.user || null;
      if (event === 'PASSWORD_RECOVERY') {
        PASSWORD_RECOVERY_ACTIVE = true;
        showResetPasswordModal();
      }
      handleAuthStateChange(SUPA_USER);
    });
    SUPA.auth.getSession().then(({ data }) => {
      SUPA_USER = data?.session?.user || null;
      handleAuthStateChange(SUPA_USER);
      if (isResetPasswordRoute() && SUPA_USER && !PASSWORD_RECOVERY_ACTIVE) {
        PASSWORD_RECOVERY_ACTIVE = true;
        showResetPasswordModal();
      } else if (isResetPasswordRoute() && !SUPA_USER) {
        showResetPasswordExpiredModal();
      }
    });
  } catch(e) { console.warn('Supabase init error:', e); }
}

// ── AUTH STATE CHANGE ────────────────────────────────────────
// Única fonte de verdade para navegação pós-login.
function handleAuthStateChange(user) {
  const currentScreen = APP.history[APP.history.length - 1];
  const activeScreen = document.querySelector('.screen.active')?.id;
  const authModalOpen = document.getElementById('auth-modal')?.classList.contains('open');
  const adminRoute = typeof isAdminRoute === 'function' && isAdminRoute();
  const commercialRoute = typeof isCommercialLandingRoute === 'function' && isCommercialLandingRoute();
  const resetPasswordRoute = isResetPasswordRoute();
  const updateAdminButton = (access) => {
    const adminBtn = document.getElementById('admin-menu-btn');
    if (adminBtn) adminBtn.style.display = (access?.isAdmin || user?.email === ADMIN_EMAIL) ? '' : 'none';
  };

  if (adminRoute && !user) {
    if (typeof showAdminRouteLogin === 'function') showAdminRouteLogin();
  }

  // Logou pela landing ou pelo modal → entra no app mesmo se o histórico interno estiver defasado.
  if (user && !adminRoute && !commercialRoute && !resetPasswordRoute && (currentScreen === 'screen-landing' || activeScreen === 'screen-landing' || authModalOpen)) {
    enterApp();
  }
  if (user) APP.isGuest = false;
  if (typeof updateGuestConversionUI === 'function') updateGuestConversionUI();
  if (typeof refreshAccess === 'function') {
    refreshAccess(user).then(access => {
      if (typeof renderPlanSurfaces === 'function') renderPlanSurfaces(access);
      if (typeof showProExpiredNotice === 'function') showProExpiredNotice(access);
      if (user) buildUserMenu(user);
      updateAdminButton(access);
      if (adminRoute) {
        if (access?.isAdmin) {
          if (typeof showAdminRouteLoading === 'function') showAdminRouteLoading();
          openAdmin();
        } else if (user && typeof showAdminRouteDenied === 'function') {
          showAdminRouteDenied();
        }
      }
      if (commercialRoute && sessionStorage.getItem('bt8_open_plans_after_login') === '1') {
        sessionStorage.removeItem('bt8_open_plans_after_login');
        setTimeout(() => { if (typeof openPlansModal === 'function') openPlansModal(); }, 600);
      }
      const params = new URLSearchParams(window.location.search);
      const shouldContinueCheckout = commercialRoute && (
        params.get('next') === 'checkout' ||
        (typeof getPendingCheckoutIntent === 'function' && getPendingCheckoutIntent()?.plan)
      );
      if (user && shouldContinueCheckout && typeof continuePendingCheckout === 'function') {
        setTimeout(() => continuePendingCheckout(params.get('auth') === 'confirmed' ? 'email_confirmed' : 'login_completed'), 700);
      }
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

function isResetPasswordRoute() {
  return window.location.pathname.replace(/\/+$/, '') === '/reset-password';
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

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  if (btn) {
    btn.classList.toggle('is-visible', show);
    btn.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
    btn.textContent = show ? '🙈' : '👁';
  }
  input.focus();
}

// ── AUTH MODAL ───────────────────────────────────────────────
function openAuthModal(tab, options = {}) {
  if (!options.preserveCheckoutIntent && typeof clearPendingCheckoutIntent === 'function') {
    clearPendingCheckoutIntent();
  }
  closeUserMenu();
  // Rola a landing para o topo para que o modal fique visível
  const landing = document.getElementById('lp-main') || document.getElementById('screen-landing');
  if (landing) landing.scrollTo({ top: 0, behavior: 'smooth' });
  const modal = document.getElementById('auth-modal');
  if (modal) modal.classList.add('open');
  switchAuthTab(tab || 'login');
  updateAuthIntentContext(tab || 'login');
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
  updateAuthIntentContext(tab);
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

function showResetPasswordExpiredModal() {
  const existing = document.getElementById('reset-password-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'reset-password-modal';
  modal.className = 'reset-password-modal';
  modal.innerHTML = `
    <div class="reset-password-card">
      <div class="reset-password-kicker">Link expirado</div>
      <h3>Envie um novo link</h3>
      <p>Este link de redefinição não está mais válido. Solicite um novo e-mail para criar uma nova senha.</p>
      <button class="reset-password-submit" type="button" onclick="closeResetPasswordModal();openAuthModal('login');showForgot()">Enviar novo link</button>
      <button class="reset-password-secondary" type="button" onclick="window.location.href='/'">Voltar ao início</button>
    </div>
  `;
  document.body.appendChild(modal);
}

function showResetPasswordModal() {
  closeAuthModal();
  const existing = document.getElementById('reset-password-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'reset-password-modal';
  modal.className = 'reset-password-modal';
  modal.innerHTML = `
    <div class="reset-password-card">
      <div class="reset-password-kicker">Redefinição de senha</div>
      <h3>Crie sua nova senha</h3>
      <p>Escolha uma senha segura para voltar a acessar sua conta BT8.</p>

      <div class="auth-field">
        <label>Nova senha</label>
        <div class="password-wrap">
          <input class="auth-input password-input" type="password" id="reset-new-pw" placeholder="Mínimo 8 caracteres" oninput="checkResetPw()">
          <button class="password-toggle" type="button" aria-label="Mostrar senha" onclick="togglePasswordVisibility('reset-new-pw', this)">👁</button>
        </div>
      </div>
      <div class="auth-field">
        <label>Confirmar nova senha</label>
        <div class="password-wrap">
          <input class="auth-input password-input" type="password" id="reset-confirm-pw" placeholder="Repita a senha" oninput="checkResetPw()">
          <button class="password-toggle" type="button" aria-label="Mostrar senha" onclick="togglePasswordVisibility('reset-confirm-pw', this)">👁</button>
        </div>
      </div>
      <div class="pw-checks reset-pw-checks">
        <span class="pw-check" id="reset-pwc-len">8 ou mais caracteres</span>
        <span class="pw-check" id="reset-pwc-letter">Pelo menos 1 letra</span>
        <span class="pw-check" id="reset-pwc-num">Pelo menos 1 número</span>
        <span class="pw-check" id="reset-pwc-match">As senhas precisam ser iguais</span>
      </div>
      <button class="reset-password-submit" id="btn-reset-password" type="button" onclick="saveNewPassword()" disabled>Salvar nova senha</button>
      <div id="reset-password-msg" class="reset-password-msg"></div>
    </div>
  `;
  document.body.appendChild(modal);
  setTimeout(() => document.getElementById('reset-new-pw')?.focus(), 50);
}

function closeResetPasswordModal() {
  document.getElementById('reset-password-modal')?.remove();
}

function checkResetPw() {
  const pw = document.getElementById('reset-new-pw')?.value || '';
  const confirm = document.getElementById('reset-confirm-pw')?.value || '';
  const okLen = pw.length >= 8;
  const okLetter = /[a-zA-Z]/.test(pw);
  const okNum = /[0-9]/.test(pw);
  const okMatch = !!pw && pw === confirm;
  const set = (id, ok) => {
    const el = document.getElementById(id);
    if (el) el.className = 'pw-check' + (ok ? ' ok' : '');
  };
  set('reset-pwc-len', okLen);
  set('reset-pwc-letter', okLetter);
  set('reset-pwc-num', okNum);
  set('reset-pwc-match', okMatch);
  const btn = document.getElementById('btn-reset-password');
  if (btn) btn.disabled = !(okLen && okLetter && okNum && okMatch);
  return okLen && okLetter && okNum && okMatch;
}

async function saveNewPassword() {
  if (!SUPA) return;
  const msg = document.getElementById('reset-password-msg');
  const btn = document.getElementById('btn-reset-password');
  const pw = document.getElementById('reset-new-pw')?.value || '';
  if (!checkResetPw()) {
    if (msg) {
      msg.className = 'reset-password-msg err';
      msg.textContent = 'Confira os requisitos da senha.';
    }
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Salvando...';
  }
  if (msg) {
    msg.className = 'reset-password-msg';
    msg.textContent = 'Atualizando sua senha com segurança...';
  }

  try {
    const { error } = await SUPA.auth.updateUser({ password: pw });
    if (error) throw error;
    PASSWORD_RECOVERY_ACTIVE = false;
    if (msg) {
      msg.className = 'reset-password-msg ok';
      msg.textContent = 'Senha atualizada. Redirecionando para o login...';
    }
    await SUPA.auth.signOut().catch(() => {});
    setTimeout(() => {
      window.history.replaceState({}, document.title, '/');
      closeResetPasswordModal();
      openAuthModal('login');
      showAuthMsg('Senha atualizada. Entre com sua nova senha.', 'success');
    }, 900);
  } catch (e) {
    if (msg) {
      msg.className = 'reset-password-msg err';
      msg.textContent = e.message || 'Não foi possível atualizar a senha.';
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Salvar nova senha';
    }
  }
}

function clearAuthMsg() {
  const m = document.getElementById('auth-msg');
  if (m) { m.className = 'auth-msg'; m.textContent = ''; }
}

function updateAuthIntentContext(tab) {
  const box = document.getElementById('auth-context-msg');
  const signupBtn = document.querySelector('#form-signup .btn-auth-submit');
  const loginBtn = document.querySelector('#form-login .btn-auth-submit');
  const intent = typeof getPendingCheckoutIntent === 'function' ? getPendingCheckoutIntent() : null;
  const hasPaidIntent = intent?.plan === 'pro_monthly' || intent?.plan === 'pro_30d';
  if (signupBtn && !signupBtn.disabled) signupBtn.textContent = hasPaidIntent ? 'CRIAR CONTA E CONTINUAR' : 'CADASTRAR';
  if (loginBtn && !loginBtn.disabled) loginBtn.textContent = hasPaidIntent ? 'ENTRAR E CONTINUAR' : 'ENTRAR';
  if (!box) return;
  if (!hasPaidIntent || tab === 'forgot') {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  const label = typeof checkoutPlanLabel === 'function' ? checkoutPlanLabel(intent.plan) : 'BT8 Pro';
  box.style.display = '';
  box.innerHTML = tab === 'login'
    ? `<strong>${label}</strong>Entre na sua conta para continuar para o checkout seguro.`
    : `<strong>${label}</strong>Para assinar, crie sua conta primeiro. Depois de confirmar o e-mail, você será levado automaticamente ao checkout seguro.`;
}

function showAuthMsg(text, type) {
  const m = document.getElementById('auth-msg');
  if (!m) return;
  m.className = 'auth-msg ' + type;
  m.textContent = text;
}

function showEmailConfirmationModal(email, intent) {
  const existing = document.getElementById('email-confirm-modal');
  if (existing) existing.remove();
  const hasPlan = intent?.plan === 'pro_monthly' || intent?.plan === 'pro_30d';
  const planLabel = hasPlan && typeof checkoutPlanLabel === 'function' ? checkoutPlanLabel(intent.plan) : '';
  const modal = document.createElement('div');
  modal.id = 'email-confirm-modal';
  modal.className = 'email-confirm-modal';
  modal.innerHTML = `
    <div class="email-confirm-card">
      <div class="email-confirm-icon">✉</div>
      <div class="email-confirm-kicker">${hasPlan ? planLabel : 'Cadastro criado'}</div>
      <h3>Confirme seu e-mail para continuar</h3>
      <p>Enviamos um link para <strong>${email || 'seu e-mail'}</strong>. Abra sua caixa de entrada e clique no link de confirmação.</p>
      <div class="email-confirm-note">
        ${hasPlan
          ? 'Depois da confirmação, você volta para o BT8 e o checkout seguro abre automaticamente.'
          : 'Depois da confirmação, volte ao BT8 e entre na sua conta para salvar seus torneios.'}
      </div>
      <button onclick="document.getElementById('email-confirm-modal')?.remove()">Entendi, vou confirmar</button>
      <button class="email-confirm-link" onclick="document.getElementById('email-confirm-modal')?.remove();switchAuthTab('login')">Já confirmei, quero entrar</button>
    </div>
  `;
  document.body.appendChild(modal);
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
    const intent = typeof getPendingCheckoutIntent === 'function' ? getPendingCheckoutIntent() : null;
    const redirectTo = intent?.plan && typeof checkoutEmailRedirectTo === 'function'
      ? checkoutEmailRedirectTo(intent.plan)
      : window.location.origin;
    const { error } = await SUPA.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
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
    const { data, error } = await SUPA.auth.signInWithPassword({ email, password: pw });
    if (error) {
      showAuthMsg(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos' : error.message, 'error');
    } else {
      SUPA_USER = data?.session?.user || data?.user || null;
      if (SUPA_USER) handleAuthStateChange(SUPA_USER);
      else {
        const sessionResult = await SUPA.auth.getSession().catch(() => ({ data: null }));
        SUPA_USER = sessionResult?.data?.session?.user || null;
        if (SUPA_USER) handleAuthStateChange(SUPA_USER);
      }
      if (typeof trackEvent === 'function') trackEvent('login_completed', { provider: 'email' });
    }
  } catch(e) { showAuthMsg('Erro ao conectar', 'error'); }
  if (btn) { btn.disabled = false; }
  updateAuthIntentContext('login');
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
    if (typeof trackEvent === 'function') trackEvent('signup_started', { provider: 'email' });
    const { data, error } = await SUPA.auth.signUp({
      email, password: pw,
      options: {
        data: { full_name: name },
        ...(typeof getPendingCheckoutIntent === 'function' && getPendingCheckoutIntent()?.plan && typeof checkoutEmailRedirectTo === 'function'
          ? { emailRedirectTo: checkoutEmailRedirectTo(getPendingCheckoutIntent().plan) }
          : {})
      }
    });
    if (error) { showAuthMsg(error.message, 'error'); }
    else if (data?.user?.identities?.length === 0) {
      showAuthMsg('E-mail já cadastrado. Faça login.', 'error');
      setTimeout(() => switchAuthTab('login'), 2000);
    } else {
      const intent = typeof getPendingCheckoutIntent === 'function' ? getPendingCheckoutIntent() : null;
      if (data?.session && intent?.plan && typeof continuePendingCheckout === 'function') {
        showAuthMsg('Conta criada. Abrindo checkout seguro...', 'success');
        setTimeout(() => continuePendingCheckout('signup_autoconfirmed'), 500);
      } else {
        showAuthMsg('Conta criada. Confirme seu e-mail para continuar.', 'success');
        showEmailConfirmationModal(email, intent);
      }
      if (typeof trackEvent === 'function') trackEvent('signup_completed', { provider: 'email' });
    }
  } catch(e) { showAuthMsg('Erro ao criar conta', 'error'); }
  if (btn) { btn.disabled = false; }
  updateAuthIntentContext('signup');
}

async function doForgot() {
  if (!SUPA) return showAuthMsg('Serviço indisponível', 'error');
  const email = document.getElementById('forgot-email')?.value?.trim();
  if (!email) return showAuthMsg('Informe seu e-mail', 'error');
  try {
    const { error } = await SUPA.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
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
  if (typeof clearPendingCheckoutIntent === 'function') clearPendingCheckoutIntent();
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
  const { data, error } = await SUPA.auth.signInWithPassword({ email, password: pw }).catch(() => ({ error: { message: 'Erro' } }));
  if (error) lpShowMsg(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos' : error.message, 'error');
  else {
    SUPA_USER = data?.session?.user || data?.user || null;
    if (SUPA_USER) handleAuthStateChange(SUPA_USER);
  }
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
  const { error } = await SUPA.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` }).catch(() => ({ error: { message: 'Erro' } }));
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
