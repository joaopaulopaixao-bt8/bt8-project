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
      <button onclick="trackEvent('upgrade_clicked',{source:'free_limit_modal'});document.getElementById('upgrade-modal').remove();openPlansModal();"
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

function openPlansModal() {
  if (!SUPA_USER) {
    openAuthModal('signup');
    return;
  }

  const existing = document.getElementById('plans-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'plans-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:1650;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:18px;overflow:auto;';
  modal.innerHTML = `
    <div style="width:100%;max-width:460px;background:#0d1a27;border:1px solid rgba(26,127,196,.45);border-radius:18px;padding:22px 18px;box-shadow:0 20px 60px rgba(0,0,0,.45);position:relative;">
      <button onclick="document.getElementById('plans-modal').remove()" style="position:absolute;top:12px;right:12px;border:0;background:transparent;color:#7aa8c4;font-size:20px;cursor:pointer;">x</button>
      <div style="font-family:'Bebas Neue';font-size:28px;letter-spacing:1.5px;color:#ffd84d;text-align:center;margin-bottom:6px;">BT8 PRO</div>
      <div style="font-size:13px;line-height:1.5;color:#a8c4d4;text-align:center;margin-bottom:18px;">Salve torneios ilimitados, mantenha seu histórico completo e use o BT8 sem travas na organização.</div>
      <div style="display:grid;gap:10px;">
        <div style="border:1px solid rgba(244,192,38,.45);border-radius:14px;padding:16px;background:rgba(244,192,38,.08);">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
            <div>
              <div style="font-weight:800;color:#fff;font-size:15px;">Pro Mensal</div>
              <div style="font-size:12px;color:#a8c4d4;margin-top:3px;">Recorrente, cancele quando quiser.</div>
            </div>
            <div style="font-family:'Bebas Neue';font-size:24px;color:#ffd84d;white-space:nowrap;">R$ 6,90</div>
          </div>
          <button id="btn-checkout-monthly" onclick="startCheckout('pro_monthly')" style="width:100%;margin-top:12px;border:0;border-radius:11px;background:#ffd84d;color:#07111c;font-weight:800;padding:12px;cursor:pointer;">ASSINAR MENSAL</button>
        </div>
        <div style="border:1px solid rgba(45,156,190,.45);border-radius:14px;padding:16px;background:rgba(45,156,190,.08);">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
            <div>
              <div style="font-weight:800;color:#fff;font-size:15px;">Pro 30 Dias</div>
              <div style="font-size:12px;color:#a8c4d4;margin-top:3px;">Pagamento único para testar sem recorrência.</div>
            </div>
            <div style="font-family:'Bebas Neue';font-size:24px;color:#5cc8f2;white-space:nowrap;">R$ 14,90</div>
          </div>
          <button id="btn-checkout-30d" onclick="startCheckout('pro_30d')" style="width:100%;margin-top:12px;border:1px solid rgba(92,200,242,.4);border-radius:11px;background:rgba(92,200,242,.16);color:#dff7ff;font-weight:800;padding:12px;cursor:pointer;">COMPRAR 30 DIAS</button>
        </div>
      </div>
      <div id="plans-msg" style="min-height:18px;margin-top:12px;text-align:center;font-size:12px;color:#f87171;"></div>
    </div>`;
  document.body.appendChild(modal);
}

async function startCheckout(plan) {
  if (!SUPA || !SUPA_USER) return openAuthModal('login');
  const msg = document.getElementById('plans-msg');
  const btnMonthly = document.getElementById('btn-checkout-monthly');
  const btn30d = document.getElementById('btn-checkout-30d');
  [btnMonthly, btn30d].forEach(btn => { if (btn) btn.disabled = true; });
  if (msg) {
    msg.style.color = '#a8c4d4';
    msg.textContent = 'Abrindo checkout seguro...';
  }

  try {
    const { data: sessionData } = await SUPA.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Faça login novamente para continuar.');

    trackEvent('checkout_started', { plan });
    const response = await fetch('/.netlify/functions/create-checkout', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ plan, origin: window.location.origin })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const missing = data.missing?.length ? ` Variáveis faltando: ${data.missing.join(', ')}.` : '';
      throw new Error((data.error || 'Nao foi possivel abrir o checkout.') + missing);
    }
    window.location.href = data.url;
  } catch (e) {
    if (msg) {
      msg.style.color = '#f87171';
      msg.textContent = e.message || 'Erro ao iniciar checkout.';
    }
    [btnMonthly, btn30d].forEach(btn => { if (btn) btn.disabled = false; });
  }
}
