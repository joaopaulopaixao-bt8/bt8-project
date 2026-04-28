// Centraliza plano/acesso para o MVP pago.
const BT8_ACCESS = {
  profile: null,
  role: 'guest',
  plan: 'guest',
  isGuest: true,
  isAdmin: false,
  isPro: false,
  proExpired: false,
  proUntil: null,
  planType: null,
  subscriptionStatus: null,
  cancelAtPeriodEnd: false,
  monthlyScheduled: false
};
const FREE_MONTHLY_TOURNAMENT_LIMIT = 3;

function normalizeAccess(profile, user, subscription) {
  const now = Date.now();
  const periodEnd = profile?.pro_until || subscription?.current_period_end;
  const proUntil = periodEnd ? new Date(periodEnd) : null;
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
    proUntil,
    planType: subscription?.plan_type || null,
    subscriptionStatus: profile?.subscription_status || subscription?.status || null,
    cancelAtPeriodEnd: !!subscription?.metadata?.cancel_at_period_end || profile?.subscription_status === 'cancel_at_period_end',
    monthlyScheduled: subscription?.plan_type === 'recurring'
      && subscription?.metadata?.previous_plan_type === 'one_time_30d'
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
    let subscription = null;
    if (data) {
      const latest = await SUPA
        .from('subscriptions')
        .select('plan_type,status,current_period_end,created_at,stripe_subscription_id,metadata')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      subscription = latest.data || null;
    }
    Object.assign(BT8_ACCESS, normalizeAccess(data, user, subscription));
  } catch (e) {
    Object.assign(BT8_ACCESS, normalizeAccess(null, user));
  }

  return BT8_ACCESS;
}

function currentAccess() {
  return BT8_ACCESS;
}

function accessLabel(access) {
  if (!access || access.isGuest) return 'Visitante';
  if (access.isAdmin) return 'Admin';
  if (access.proExpired) return 'Pro expirado';
  if (access.isPro && access.planType === 'one_time_30d') return 'Pro 30 Dias';
  if (access.isPro && access.planType === 'recurring') return 'Pro Mensal';
  if (access.isPro) return 'Pro';
  return 'Free';
}

function formatPlanDate(date) {
  if (!date) return '';
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function planDescription(access) {
  if (!access || access.isGuest) return 'Teste sem cadastro';
  if (access.isAdmin) return 'Acesso operacional liberado, sem assinatura';
  if (access.proExpired) return 'Historico preservado. Reative o Pro para salvar sem limite';
  if (access.isPro && access.planType === 'recurring') {
    if (access.cancelAtPeriodEnd) {
      return access.proUntil ? `Cancelado, valido ate ${formatPlanDate(access.proUntil)}` : 'Cancelado para o fim do ciclo';
    }
    if (access.monthlyScheduled) {
      return access.proUntil ? `Mensal comeca em ${formatPlanDate(access.proUntil)}` : 'Mensal agendado';
    }
    return access.proUntil ? `Renova em ${formatPlanDate(access.proUntil)}` : 'Assinatura mensal ativa';
  }
  if (access.isPro && access.planType === 'one_time_30d') {
    return access.proUntil ? `Ativo ate ${formatPlanDate(access.proUntil)}` : 'Acesso Pro por 30 dias';
  }
  if (access.isPro) return 'Torneios ilimitados liberados';
  return `Salva ate ${FREE_MONTHLY_TOURNAMENT_LIMIT} torneios por mes`;
}

function planCardHtml(access, context) {
  const isPro = !!access?.isPro;
  const isAdmin = !!access?.isAdmin;
  const label = accessLabel(access);
  const desc = planDescription(access);
  const compact = context === 'menu';
  const bg = isPro ? 'rgba(244,192,38,.12)' : 'rgba(45,156,190,.10)';
  const border = isPro ? 'rgba(244,192,38,.45)' : 'rgba(45,156,190,.35)';
  const color = isPro ? '#ffd84d' : '#5cc8f2';
  return `
    <div style="margin:${compact ? '6px 10px 8px' : '6px 0 14px'};padding:${compact ? '9px 10px' : '13px 14px'};border:1px solid ${border};border-radius:12px;background:${bg};">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <div style="font-size:${compact ? '11px' : '12px'};color:#7aa8c4;text-transform:uppercase;letter-spacing:.8px;">Plano atual</div>
        ${isAdmin ? '<div style="font-size:10px;color:#cfe8f5;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:3px 7px;">ADMIN</div>' : ''}
      </div>
      <div style="font-family:'Bebas Neue';font-size:${compact ? '18px' : '26px'};letter-spacing:1px;color:${color};margin-top:3px;">${label}</div>
      <div style="font-size:${compact ? '11px' : '13px'};line-height:1.4;color:#a8c4d4;margin-top:2px;">${desc}</div>
    </div>`;
}

function renderPlanSurfaces(access) {
  const profilePlan = document.getElementById('profile-plan-card');
  if (profilePlan) profilePlan.innerHTML = planCardHtml(access, 'profile');
}

function showCheckoutReturnModal(status) {
  const existing = document.getElementById('checkout-return-modal');
  if (existing) existing.remove();

  const success = status === 'success';
  const modal = document.createElement('div');
  modal.id = 'checkout-return-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:1700;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML = `
    <div style="width:100%;max-width:420px;background:#0d1a27;border:1px solid rgba(26,127,196,.45);border-radius:18px;padding:24px 20px;box-shadow:0 20px 60px rgba(0,0,0,.45);text-align:center;">
      <div style="font-size:36px;margin-bottom:8px">${success ? '✅' : '↩'}</div>
      <div style="font-family:'Bebas Neue';font-size:26px;letter-spacing:1.5px;color:${success ? '#ffd84d' : '#cfe8f5'};margin-bottom:8px;">
        ${success ? 'PAGAMENTO RECEBIDO' : 'CHECKOUT CANCELADO'}
      </div>
      <div id="checkout-return-msg" style="font-size:13px;line-height:1.55;color:#a8c4d4;margin-bottom:18px;">
        ${success ? 'Estamos atualizando seu plano. Isso pode levar alguns segundos.' : 'Nenhuma cobrança foi concluída. Você pode tentar novamente quando quiser.'}
      </div>
      <button onclick="document.getElementById('checkout-return-modal').remove()"
        style="width:100%;border:0;border-radius:12px;background:#ffd84d;color:#07111c;font-weight:800;padding:13px 12px;cursor:pointer;">
        OK
      </button>
    </div>`;
  document.body.appendChild(modal);
}

async function handleCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const checkoutStatus = params.get('checkout');
  if (!checkoutStatus) return;

  const cleanUrl = `${window.location.origin}${window.location.pathname}${window.location.hash || ''}`;
  window.history.replaceState({}, document.title, cleanUrl);
  showCheckoutReturnModal(checkoutStatus);

  if (checkoutStatus === 'success') {
    trackEvent('checkout_returned_success', { session_id: params.get('session_id') || '' });
    for (let i = 0; i < 6; i++) {
      const access = await refreshAccess(SUPA_USER);
      if (access.isPro) {
        const msg = document.getElementById('checkout-return-msg');
        if (msg) msg.textContent = `Plano atualizado: ${accessLabel(access)}. Torneios ilimitados liberados.`;
        if (typeof renderPlanSurfaces === 'function') renderPlanSurfaces(access);
        if (SUPA_USER && typeof buildUserMenu === 'function') buildUserMenu(SUPA_USER);
        if (typeof loadHomeHistory === 'function') loadHomeHistory();
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 1800));
    }
    const msg = document.getElementById('checkout-return-msg');
    if (msg) msg.textContent = 'Pagamento recebido. Se o plano ainda nao apareceu, aguarde alguns segundos e atualize a pagina.';
  } else if (checkoutStatus === 'cancelled') {
    trackEvent('checkout_cancelled', {});
  }
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
  const existing = document.getElementById('guest-limit-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'guest-limit-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:1600;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML = `
    <div style="width:100%;max-width:420px;background:#0d1a27;border:1px solid rgba(26,127,196,.45);border-radius:18px;padding:24px 20px;box-shadow:0 20px 60px rgba(0,0,0,.45);">
      <div style="font-family:'Bebas Neue';font-size:26px;letter-spacing:1.5px;color:#ffd84d;text-align:center;margin-bottom:8px;">TESTE GRATIS USADO</div>
      <div style="font-size:13px;line-height:1.55;color:#a8c4d4;text-align:center;margin-bottom:18px;">
        Seu teste gratis deste mes ja foi usado. Entre gratis para continuar criando torneios no BT8.
      </div>
      <button onclick="trackEvent('signup_started',{source:'guest_limit_modal'});document.getElementById('guest-limit-modal').remove();openAuthModal('signup');"
        style="width:100%;border:0;border-radius:12px;background:#ffd84d;color:#07111c;font-weight:800;padding:13px 12px;margin-bottom:8px;cursor:pointer;">
        CRIAR CONTA GRATIS
      </button>
      <button onclick="document.getElementById('guest-limit-modal').remove();openAuthModal('login');"
        style="width:100%;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:rgba(255,255,255,.06);color:#cfe8f5;font-weight:700;padding:12px;cursor:pointer;">
        JA TENHO CONTA
      </button>
    </div>`;
  document.body.appendChild(modal);
}

function showProExpiredNotice(access) {
  if (!access?.proExpired || !SUPA_USER) return;
  const key = `bt8_pro_expired_notice_${SUPA_USER.id}_${access.proUntil?.toISOString?.() || 'no_date'}`;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');
  trackEvent('pro_expired', { pro_until: access.proUntil?.toISOString?.() || null });

  const existing = document.getElementById('pro-expired-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'pro-expired-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:1600;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML = `
    <div style="width:100%;max-width:420px;background:#0d1a27;border:1px solid rgba(244,192,38,.38);border-radius:18px;padding:24px 20px;box-shadow:0 20px 60px rgba(0,0,0,.45);">
      <div style="font-family:'Bebas Neue';font-size:26px;letter-spacing:1.5px;color:#ffd84d;text-align:center;margin-bottom:8px;">PRO EXPIRADO</div>
      <div style="font-size:13px;line-height:1.55;color:#a8c4d4;text-align:center;margin-bottom:18px;">
        Seu historico continua guardado. Para voltar a salvar torneios sem limite, reative o BT8 Pro.
      </div>
      <button onclick="trackEvent('upgrade_clicked',{source:'pro_expired_modal'});document.getElementById('pro-expired-modal').remove();openPlansModal();"
        style="width:100%;border:0;border-radius:12px;background:#ffd84d;color:#07111c;font-weight:800;padding:13px 12px;margin-bottom:8px;cursor:pointer;">
        REATIVAR PRO
      </button>
      <button onclick="document.getElementById('pro-expired-modal').remove()"
        style="width:100%;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:rgba(255,255,255,.06);color:#cfe8f5;font-weight:700;padding:12px;cursor:pointer;">
        AGORA NAO
      </button>
    </div>`;
  document.body.appendChild(modal);
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
  const current = typeof currentAccess === 'function' ? currentAccess() : null;
  if (current?.isAdmin) {
    alert('Conta Admin nao assina planos. O acesso operacional ja esta liberado.');
    return;
  }

  const existing = document.getElementById('plans-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  const access = current;
  const isPro = !!access?.isPro;
  const planStatus = planCardHtml(access, 'profile');
  const isMonthly = isPro && access?.planType === 'recurring';
  const isOneTime30d = isPro && access?.planType === 'one_time_30d';
  const planBody = isMonthly
    ? `
      ${planStatus}
      <div style="border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:16px;background:rgba(255,255,255,.05);text-align:center;">
        <div style="font-weight:800;color:#fff;font-size:15px;">${access.cancelAtPeriodEnd ? 'Renovacao cancelada' : access.monthlyScheduled ? 'Mensal agendado' : 'Assinatura mensal ativa'}</div>
        <div style="font-size:12px;color:#a8c4d4;line-height:1.5;margin-top:6px;">
          ${access.cancelAtPeriodEnd
            ? 'Voce continua Pro ate a data ja paga. Depois disso, a conta volta para Free automaticamente.'
            : access.monthlyScheduled
              ? 'A primeira cobranca mensal ficou agendada para o vencimento do seu Pro 30 dias.'
              : 'Voce pode cancelar a recorrencia agora e continuar usando o Pro ate a data ja paga.'}
        </div>
      </div>
      ${access.cancelAtPeriodEnd ? `
        <button onclick="document.getElementById('plans-modal').remove()"
          style="width:100%;margin-top:12px;border:0;border-radius:11px;background:#ffd84d;color:#07111c;font-weight:800;padding:12px;cursor:pointer;">
          ENTENDI
        </button>` : `
        <button id="btn-cancel-subscription" onclick="cancelRecurringSubscription()"
          style="width:100%;margin-top:12px;border:1px solid rgba(248,113,113,.45);border-radius:11px;background:rgba(248,113,113,.12);color:#fecaca;font-weight:800;padding:12px;cursor:pointer;">
          CANCELAR COBRANCA RECORRENTE
        </button>`}`
    : isOneTime30d
      ? `
      ${planStatus}
      <div style="border:1px solid rgba(244,192,38,.35);border-radius:14px;padding:16px;background:rgba(244,192,38,.07);text-align:center;">
        <div style="font-weight:800;color:#fff;font-size:15px;">Migrar para mensal no vencimento</div>
        <div style="font-size:12px;color:#a8c4d4;line-height:1.5;margin-top:6px;">
          Voce pode deixar a mensalidade assinada agora. A cobranca mensal comeca somente quando o Pro 30 dias vencer.
        </div>
      </div>
      <button id="btn-checkout-monthly" onclick="startCheckout('pro_monthly')"
        style="width:100%;margin-top:12px;border:0;border-radius:11px;background:#ffd84d;color:#07111c;font-weight:800;padding:12px;cursor:pointer;">
        ASSINAR MENSAL A PARTIR DO VENCIMENTO
      </button>`
    : isPro
      ? `
      ${planStatus}
      <div style="border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:16px;background:rgba(255,255,255,.05);text-align:center;">
        <div style="font-weight:800;color:#fff;font-size:15px;">Seu acesso Pro esta ativo</div>
        <div style="font-size:12px;color:#a8c4d4;line-height:1.5;margin-top:6px;">
          Esta conta ja esta liberada para torneios ilimitados.
        </div>
      </div>`
    : `
      ${planStatus}
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
              <div style="font-size:12px;color:#a8c4d4;margin-top:3px;">Pagamento unico para testar sem recorrencia.</div>
            </div>
            <div style="font-family:'Bebas Neue';font-size:24px;color:#5cc8f2;white-space:nowrap;">R$ 14,90</div>
          </div>
          <button id="btn-checkout-30d" onclick="startCheckout('pro_30d')" style="width:100%;margin-top:12px;border:1px solid rgba(92,200,242,.4);border-radius:11px;background:rgba(92,200,242,.16);color:#dff7ff;font-weight:800;padding:12px;cursor:pointer;">COMPRAR 30 DIAS</button>
        </div>
      </div>`;
  modal.id = 'plans-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:1650;background:rgba(0,0,0,.78);display:flex;align-items:center;justify-content:center;padding:18px;overflow:auto;';
  modal.innerHTML = `
    <div style="width:100%;max-width:460px;background:#0d1a27;border:1px solid rgba(26,127,196,.45);border-radius:18px;padding:22px 18px;box-shadow:0 20px 60px rgba(0,0,0,.45);position:relative;">
      <button onclick="document.getElementById('plans-modal').remove()" style="position:absolute;top:12px;right:12px;border:0;background:transparent;color:#7aa8c4;font-size:20px;cursor:pointer;">x</button>
      <div style="font-family:'Bebas Neue';font-size:28px;letter-spacing:1.5px;color:#ffd84d;text-align:center;margin-bottom:6px;">${isPro ? 'MEU PLANO' : 'BT8 PRO'}</div>
      <div style="font-size:13px;line-height:1.5;color:#a8c4d4;text-align:center;margin-bottom:18px;">${isPro ? 'Este e o plano ativo nesta conta.' : 'Salve torneios ilimitados, mantenha seu historico completo e use o BT8 sem travas na organizacao.'}</div>
      ${planBody}
      <div id="plans-msg" style="min-height:18px;margin-top:12px;text-align:center;font-size:12px;color:#f87171;"></div>
    </div>`;
  document.body.appendChild(modal);
}

async function cancelRecurringSubscription() {
  if (!SUPA || !SUPA_USER) return openAuthModal('login');
  const msg = document.getElementById('plans-msg');
  const btn = document.getElementById('btn-cancel-subscription');
  if (btn) btn.disabled = true;
  if (msg) {
    msg.style.color = '#a8c4d4';
    msg.textContent = 'Cancelando renovacao no Stripe...';
  }

  try {
    const { data: sessionData } = await SUPA.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Faça login novamente para continuar.');

    const response = await fetch('/.netlify/functions/manage-subscription', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ action: 'cancel_recurring' })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Nao foi possivel cancelar a recorrencia.');

    const access = await refreshAccess(SUPA_USER);
    if (typeof renderPlanSurfaces === 'function') renderPlanSurfaces(access);
    if (typeof buildUserMenu === 'function') buildUserMenu(SUPA_USER);
    if (msg) {
      msg.style.color = '#86efac';
      msg.textContent = `Recorrencia cancelada. Seu Pro segue ativo ate ${formatPlanDate(access.proUntil)}.`;
    }
    setTimeout(openPlansModal, 900);
  } catch (e) {
    if (msg) {
      msg.style.color = '#f87171';
      msg.textContent = e.message || 'Erro ao cancelar recorrencia.';
    }
    if (btn) btn.disabled = false;
  }
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
