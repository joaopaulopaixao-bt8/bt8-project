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

const stripeRequest = async (secretKey, path, params) => {
  const cleanParams = Object.fromEntries(
    Object.entries(params || {}).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(cleanParams)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Stripe ${res.status}`);
  return data;
};

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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.BT8_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.BT8_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.BT8_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  const missing = [
    !supabaseUrl ? 'BT8_SUPABASE_URL' : null,
    !serviceKey ? 'BT8_SUPABASE_SERVICE_ROLE_KEY' : null,
    !stripeKey ? 'BT8_STRIPE_SECRET_KEY' : null
  ].filter(Boolean);
  if (missing.length) return json(500, { error: 'Subscription service is not configured.', missing });

  const token = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Login required.' });

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Invalid JSON body.' });
  }
  if (body.action !== 'cancel_recurring') return json(400, { error: 'Invalid action.' });

  try {
    const authUser = await supabaseFetch(supabaseUrl, serviceKey, 'auth/v1/user', {
      method: 'GET',
      authorization: `Bearer ${token}`
    });
    const userId = authUser?.id;
    if (!userId) return json(401, { error: 'Invalid session.' });

    const rows = await supabaseFetch(
      supabaseUrl,
      serviceKey,
      `rest/v1/subscriptions?select=id,stripe_subscription_id,current_period_end,metadata,status&user_id=eq.${encodeURIComponent(userId)}&plan_type=eq.recurring&stripe_subscription_id=not.is.null&order=created_at.desc&limit=1`
    );
    const current = rows?.[0];
    if (!current?.stripe_subscription_id) {
      return json(404, { error: 'Nenhuma assinatura mensal ativa foi encontrada.' });
    }
    if (current.metadata?.cancel_at_period_end) {
      return json(200, {
        status: current.status,
        cancel_at_period_end: true,
        current_period_end: current.current_period_end
      });
    }

    const subscription = await stripeRequest(
      stripeKey,
      `subscriptions/${current.stripe_subscription_id}`,
      { cancel_at_period_end: 'true', 'metadata[cancel_requested_by]': userId }
    );
    const periodEnd = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : current.current_period_end;
    const metadata = {
      ...(current.metadata || {}),
      cancel_at_period_end: true,
      cancel_requested_at: new Date().toISOString()
    };

    await supabaseFetch(supabaseUrl, serviceKey, `rest/v1/subscriptions?id=eq.${current.id}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'cancel_at_period_end',
        current_period_end: periodEnd,
        metadata,
        updated_at: new Date().toISOString()
      })
    });
    await supabaseFetch(supabaseUrl, serviceKey, `rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        plan: 'pro',
        pro_until: periodEnd,
        subscription_status: 'cancel_at_period_end',
        updated_at: new Date().toISOString()
      })
    });
    await supabaseFetch(supabaseUrl, serviceKey, 'rest/v1/app_events', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        user_id: userId,
        event_type: 'subscription_cancel_at_period_end',
        metadata: { subscription_id: current.stripe_subscription_id, current_period_end: periodEnd }
      })
    }).catch(() => {});

    return json(200, {
      status: 'cancel_at_period_end',
      cancel_at_period_end: true,
      current_period_end: periodEnd
    });
  } catch (e) {
    return json(500, { error: e.message || 'Subscription action failed.' });
  }
};
