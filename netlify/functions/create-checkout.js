const { stripeRequest, isResourceMissing, isRecurringActive, resolveOrigin } = require('./lib/stripe');

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization'
  },
  body: JSON.stringify(body)
});

const supabaseFetch = async (url, key, path, options = {}) => {
  const res = await fetch(`${url}/${path}`, {
    ...options,
    headers: {
      apikey: key,
      authorization: options.authorization || `Bearer ${key}`,
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = data?.message || data?.error_description || text || `Supabase ${res.status}`;
    throw new Error(message);
  }
  return data;
};

const safePath = (value, fallback) => {
  const path = String(value || fallback || '/');
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) return fallback;
  return path;
};

const appendCheckoutParams = (path, status) => {
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}checkout=${status}${status === 'success' ? '&session_id={CHECKOUT_SESSION_ID}' : ''}`;
};

// F0-30: what the buyer reads right above the pay button (custom_text max 1200 chars).
const checkoutSummary = (isMonthly) => (isMonthly
  ? 'Assinatura mensal do BT8 Pro com renovação automática todo mês, no mesmo cartão. Cancele quando quiser pelo app; o Pro continua até o fim do período pago. Você pode desistir em até 7 dias da compra e receber o valor de volta (art. 49 do CDC).'
  : 'BT8 Pro por 30 dias, pagamento único e sem renovação automática. Se você já tiver Pro, os 30 dias são somados ao prazo atual. Você pode desistir em até 7 dias da compra e receber o valor de volta (art. 49 do CDC).');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.BT8_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.BT8_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.BT8_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  const monthlyPrice = process.env.BT8_STRIPE_PRO_MONTHLY_PRICE_ID || process.env.STRIPE_PRO_MONTHLY_PRICE_ID;
  const thirtyDayPrice = process.env.BT8_STRIPE_PRO_30D_PRICE_ID || process.env.STRIPE_PRO_30D_PRICE_ID;

  const missing = [
    !supabaseUrl ? 'BT8_SUPABASE_URL' : null,
    !serviceKey ? 'BT8_SUPABASE_SERVICE_ROLE_KEY' : null,
    !stripeKey ? 'BT8_STRIPE_SECRET_KEY' : null,
    !monthlyPrice ? 'BT8_STRIPE_PRO_MONTHLY_PRICE_ID' : null,
    !thirtyDayPrice ? 'BT8_STRIPE_PRO_30D_PRICE_ID' : null
  ].filter(Boolean);
  if (missing.length) return json(500, { error: 'Checkout service is not configured.', missing });

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const plan = body.plan === 'pro_30d' ? 'pro_30d' : 'pro_monthly';
  const origin = resolveOrigin(body.origin || event.headers.origin);
  if (!origin) return json(400, { error: 'Origem do checkout não permitida.' });
  const successPath = safePath(body.success_path, '/');
  const cancelPath = safePath(body.cancel_path, '/bt8');

  const token = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Login required.' });

  try {
    const authUser = await supabaseFetch(supabaseUrl, serviceKey, 'auth/v1/user', {
      method: 'GET',
      authorization: `Bearer ${token}`
    });
    const userId = authUser?.id;
    const email = authUser?.email;
    if (!userId || !email) return json(401, { error: 'Invalid session.' });

    const profiles = await supabaseFetch(
      supabaseUrl,
      serviceKey,
      `rest/v1/profiles?select=id,email,plan,role,pro_until,stripe_customer_id&id=eq.${encodeURIComponent(userId)}&limit=1`
    );
    const profile = profiles?.[0] || {};
    if (profile.role === 'admin') {
      return json(403, { error: 'Conta Admin não pode assinar planos.' });
    }
    const isMonthly = plan === 'pro_monthly';
    // Not swallowed on purpose: if this lookup fails we must not risk a double charge.
    const recurringRows = await supabaseFetch(
      supabaseUrl,
      serviceKey,
      `rest/v1/subscriptions?select=plan_type,status,stripe_subscription_id,metadata&user_id=eq.${encodeURIComponent(userId)}&plan_type=eq.recurring&stripe_subscription_id=not.is.null&order=created_at.desc&limit=1`
    );
    if (isRecurringActive(recurringRows?.[0])) {
      return json(409, {
        error: isMonthly
          ? 'Esta conta já tem uma assinatura mensal ativa.'
          : 'Sua assinatura mensal está ativa e já inclui o Pro. O plano de 30 dias fica disponível depois que você cancelar a renovação.'
      });
    }

    const createCustomer = async () => {
      const customer = await stripeRequest(stripeKey, 'customers', {
        body: { email, 'metadata[user_id]': userId }
      });
      await supabaseFetch(supabaseUrl, serviceKey, `rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({ stripe_customer_id: customer.id, email })
      });
      return customer.id;
    };
    let customerId = profile.stripe_customer_id || await createCustomer();

    const latest30dRows = await supabaseFetch(
      supabaseUrl,
      serviceKey,
      `rest/v1/subscriptions?select=plan_type,status,current_period_end,metadata&user_id=eq.${encodeURIComponent(userId)}&plan_type=eq.one_time_30d&order=created_at.desc&limit=1`
    ).catch(() => []);
    const latest30d = latest30dRows?.[0] || null;
    const proUntil = profile.pro_until ? new Date(profile.pro_until) : null;
    const activeUntil = proUntil && proUntil.getTime() > Date.now() ? proUntil : null;
    const hasActiveProProfile = profile.plan === 'pro' && !!activeUntil;
    const latest30dIsActive = latest30d?.plan_type === 'one_time_30d'
      && ['active', 'paid', 'complete', 'succeeded'].includes(String(latest30d.status || '').toLowerCase());
    const isActive30d = hasActiveProProfile && latest30dIsActive;

    const billingAnchor = isMonthly && isActive30d
      ? Math.floor(activeUntil.getTime() / 1000)
      : null;
    const sessionParams = {
      mode: isMonthly ? 'subscription' : 'payment',
      customer: customerId,
      client_reference_id: userId,
      'line_items[0][price]': isMonthly ? monthlyPrice : thirtyDayPrice,
      'line_items[0][quantity]': '1',
      // F0-03: card only until async methods (boleto/Pix) are tested end to end.
      'payment_method_types[0]': 'card',
      locale: 'pt-BR',
      'consent_collection[terms_of_service]': 'required',
      'custom_text[terms_of_service_acceptance][message]': `Li e aceito os [Termos de uso](${origin}/termos-de-uso) e a [Política de privacidade](${origin}/politica-de-privacidade).`,
      'custom_text[submit][message]': checkoutSummary(isMonthly),
      success_url: `${origin}${appendCheckoutParams(successPath, 'success')}`,
      cancel_url: `${origin}${appendCheckoutParams(cancelPath, 'cancelled')}`,
      'metadata[user_id]': userId,
      'metadata[plan_type]': isMonthly ? 'recurring' : 'one_time_30d',
      'metadata[price_id]': isMonthly ? monthlyPrice : thirtyDayPrice
    };
    if (isMonthly) {
      sessionParams['subscription_data[metadata][user_id]'] = userId;
      sessionParams['subscription_data[metadata][plan_type]'] = 'recurring';
      if (billingAnchor) {
        sessionParams.payment_method_collection = 'always';
        sessionParams['subscription_data[billing_cycle_anchor]'] = String(billingAnchor);
        sessionParams['subscription_data[proration_behavior]'] = 'none';
        sessionParams['subscription_data[metadata][previous_plan_type]'] = 'one_time_30d';
        sessionParams['subscription_data[metadata][scheduled_from_30d_until]'] = activeUntil.toISOString();
        sessionParams['subscription_data[metadata][scheduled_strategy]'] = 'billing_cycle_anchor';
      }
    }

    const createSession = async (params) => {
      try {
        return await stripeRequest(stripeKey, 'checkout/sessions', { body: params });
      } catch (stripeError) {
        // F0-08: a test-mode customer id does not exist in live mode; start a new customer.
        if (isResourceMissing(stripeError) && stripeError.param === 'customer') {
          customerId = await createCustomer();
          return stripeRequest(stripeKey, 'checkout/sessions', { body: { ...params, customer: customerId } });
        }
        throw stripeError;
      }
    };

    let session;
    let scheduledStrategy = billingAnchor ? 'billing_cycle_anchor' : null;
    try {
      session = await createSession(sessionParams);
    } catch (stripeError) {
      const canFallbackToTrial = billingAnchor && (
        stripeError.param === 'subscription_data[billing_cycle_anchor]' ||
        /billing_cycle_anchor/i.test(stripeError.message || '') ||
        /proration_behavior/i.test(stripeError.message || '')
      );
      if (!canFallbackToTrial) throw stripeError;

      const fallbackParams = { ...sessionParams, customer: customerId };
      delete fallbackParams['subscription_data[billing_cycle_anchor]'];
      delete fallbackParams['subscription_data[proration_behavior]'];
      fallbackParams.payment_method_collection = 'always';
      fallbackParams['subscription_data[trial_end]'] = String(billingAnchor);
      fallbackParams['subscription_data[metadata][scheduled_strategy]'] = 'trial_end_fallback';
      session = await createSession(fallbackParams);
      scheduledStrategy = 'trial_end_fallback';
    }

    await supabaseFetch(supabaseUrl, serviceKey, 'rest/v1/subscriptions', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        user_id: userId,
        stripe_customer_id: customerId,
        plan_type: isMonthly ? 'recurring' : 'one_time_30d',
        status: 'checkout_started',
        price_id: isMonthly ? monthlyPrice : thirtyDayPrice,
        current_period_end: billingAnchor ? activeUntil.toISOString() : null,
        metadata: {
          checkout_session_id: session.id,
          billing_cycle_anchor: billingAnchor,
          previous_plan_type: billingAnchor ? 'one_time_30d' : null,
          scheduled_strategy: scheduledStrategy
        }
      })
    }).catch(() => {});

    return json(200, { url: session.url, session_id: session.id });
  } catch (e) {
    console.error('create-checkout failed', {
      message: e.message,
      type: e.type,
      code: e.code,
      param: e.param,
      status: e.status
    });
    return json(500, { error: e.message || 'Checkout failed.' });
  }
};
