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
