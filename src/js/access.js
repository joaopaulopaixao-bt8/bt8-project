// Centraliza plano/acesso para o MVP pago.
const BT8_ACCESS = {
  profile: null,
  role: 'guest',
  plan: 'guest',
  isGuest: true,
  isAdmin: false,
  isPro: false,
  proExpired: false,
  proUntil: null
};
const FREE_MONTHLY_TOURNAMENT_LIMIT = 3;

function normalizeAccess(profile, user) {
  const now = Date.now();
  const proUntil = profile?.pro_until ? new Date(profile.pro_until) : null;
  const plan = profile?.plan || (user ? 'free' : 'guest');
  const isProByDate = !!(proUntil && proUntil.getTime() > now);
  const isPro = plan === 'pro' && (!proUntil || isProByDate);

  return {
    profile: profile || null,
    role: profile?.role || (user ? 'user' : 'guest'),
    plan,
    isGuest: !user,
    isAdmin: profile?.role === 'admin' || user?.email === ADMIN_EMAIL,
    isPro,
    proExpired: plan === 'pro' && !!proUntil && !isProByDate,
    proUntil
  };
}

async function refreshAccess(user) {
  if (!user || !SUPA) {
    Object.assign(BT8_ACCESS, normalizeAccess(null, null));
    return BT8_ACCESS;
  }

  try {
    const { data, error } = await SUPA
      .from('profiles')
      .select('id,email,nome,plan,role,pro_until,subscription_status,stripe_customer_id')
      .eq('id', user.id)
      .maybeSingle();
    if (error) throw error;
    Object.assign(BT8_ACCESS, normalizeAccess(data, user));
  } catch (e) {
    Object.assign(BT8_ACCESS, normalizeAccess(null, user));
  }

  return BT8_ACCESS;
}

function currentAccess() {
  return BT8_ACCESS;
}

function getGuestId() {
  const key = 'bt8_guest_id';
  let guestId = localStorage.getItem(key);
  if (!guestId) {
    guestId = (window.crypto?.randomUUID && window.crypto.randomUUID()) ||
      `guest_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, guestId);
  }
  return guestId;
}

async function validateGuestTournamentLimit() {
  if (!APP.isGuest || SUPA_USER) return { allowed: true };

  const response = await fetch('/.netlify/functions/guest-usage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ guest_id: getGuestId() })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Nao foi possivel validar o teste gratis.');
  return data;
}

function showGuestLimitReached() {
  trackEvent('guest_limit_reached', { source: 'frontend' });
  alert('Seu teste gratis deste mes ja foi usado. Entre gratis para continuar criando torneios no BT8.');
  openAuthModal('signup');
}

function monthStartIso() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

async function validateFreeSaveLimit() {
  const access = await refreshAccess(SUPA_USER);
  if (!SUPA || !SUPA_USER || access.isPro || access.isAdmin) {
    return { allowed: true, limit: null, used: 0 };
  }

  const { count, error } = await SUPA
    .from('tournaments')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', SUPA_USER.id)
    .gte('created_at', monthStartIso());

  if (error) throw error;

  const used = count || 0;
  return {
    allowed: used < FREE_MONTHLY_TOURNAMENT_LIMIT,
    used,
    limit: FREE_MONTHLY_TOURNAMENT_LIMIT
  };
}

function showFreeLimitReached(limitInfo) {
  trackEvent('free_limit_reached', {
    used: limitInfo?.used || FREE_MONTHLY_TOURNAMENT_LIMIT,
    limit: limitInfo?.limit || FREE_MONTHLY_TOURNAMENT_LIMIT
  });

  const existing = document.getElementById('upgrade-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'upgrade-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:1600;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML = `
    <div style="width:100%;max-width:420px;background:#0d1a27;border:1px solid rgba(26,127,196,.45);border-radius:18px;padding:24px 20px;box-shadow:0 20px 60px rgba(0,0,0,.45);">
      <div style="font-family:'Bebas Neue';font-size:26px;letter-spacing:1.5px;color:#ffd84d;text-align:center;margin-bottom:8px;">LIMITE FREE ATINGIDO</div>
      <div style="font-size:13px;line-height:1.55;color:#a8c4d4;text-align:center;margin-bottom:18px;">
        Seu plano Free salva até ${FREE_MONTHLY_TOURNAMENT_LIMIT} torneios por mês. O histórico já criado continua guardado. Para salvar torneios ilimitados, ative o BT8 Pro.
      </div>
      <button onclick="trackEvent('upgrade_clicked',{source:'free_limit_modal'});document.getElementById('upgrade-modal').remove();alert('Checkout Pro entra na próxima etapa do MVP.');"
        style="width:100%;border:0;border-radius:12px;background:#ffd84d;color:#07111c;font-weight:800;padding:13px 12px;margin-bottom:8px;cursor:pointer;">
        QUERO O BT8 PRO
      </button>
      <button onclick="document.getElementById('upgrade-modal').remove()"
        style="width:100%;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:rgba(255,255,255,.06);color:#cfe8f5;font-weight:700;padding:12px;cursor:pointer;">
        AGORA NAO
      </button>
    </div>`;
  document.body.appendChild(modal);
}
