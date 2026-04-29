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
    const message = data?.message || data?.error_description || data?.error || text || `Supabase ${res.status}`;
    throw new Error(message);
  }
  return data;
};

const stripeRequest = async (secretKey, path, options = {}) => {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: options.method || 'POST',
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: options.body ? new URLSearchParams(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Stripe ${res.status}`);
  return data;
};

const isSubscriptionFinal = (status) => (
  ['canceled', 'incomplete_expired', 'admin_blocked', 'account_deleted'].includes(String(status || '').toLowerCase())
);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.BT8_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.BT8_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.BT8_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  const missing = [
    !supabaseUrl ? 'BT8_SUPABASE_URL' : null,
    !serviceKey ? 'BT8_SUPABASE_SERVICE_ROLE_KEY' : null
  ].filter(Boolean);
  if (missing.length) return json(500, { error: 'Account deletion service is not configured.', missing });

  const token = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Login required.' });

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Invalid JSON body.' });
  }
  if (body.confirmation !== 'EXCLUIR') {
    return json(400, { error: 'Digite EXCLUIR para confirmar.' });
  }

  try {
    const authUser = await supabaseFetch(supabaseUrl, serviceKey, 'auth/v1/user', {
      method: 'GET',
      authorization: `Bearer ${token}`
    });
    const userId = authUser?.id;
    if (!userId) return json(401, { error: 'Invalid session.' });

    const profiles = await supabaseFetch(
      supabaseUrl,
      serviceKey,
      `rest/v1/profiles?select=id,email,nome,plan,role,pro_until,subscription_status,stripe_customer_id&id=eq.${encodeURIComponent(userId)}&limit=1`
    );
    const profile = profiles?.[0] || {};
    if (profile.role === 'admin') {
      return json(403, { error: 'Conta Admin não pode ser excluída pelo app.' });
    }

    const subscriptions = await supabaseFetch(
      supabaseUrl,
      serviceKey,
      `rest/v1/subscriptions?select=id,stripe_subscription_id,plan_type,status,current_period_end,metadata&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=50`
    ).catch(() => []);

    const stripeSubscriptions = (subscriptions || [])
      .filter(sub => sub.stripe_subscription_id && !isSubscriptionFinal(sub.status));

    if (stripeSubscriptions.length && !stripeKey) {
      return json(500, { error: 'Stripe is not configured to cancel active subscriptions.', missing: ['BT8_STRIPE_SECRET_KEY'] });
    }

    for (const sub of stripeSubscriptions) {
      await stripeRequest(stripeKey, `subscriptions/${sub.stripe_subscription_id}`, { method: 'DELETE' })
        .catch(async (e) => {
          if (!/canceled|No such subscription/i.test(e.message || '')) throw e;
        });
      await supabaseFetch(supabaseUrl, serviceKey, `rest/v1/subscriptions?id=eq.${sub.id}`, {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({
          status: 'account_deleted',
          current_period_end: null,
          metadata: {
            ...(sub.metadata || {}),
            account_deleted: true,
            deleted_at: new Date().toISOString()
          },
          updated_at: new Date().toISOString()
        })
      }).catch(() => {});
    }

    await supabaseFetch(supabaseUrl, serviceKey, 'rest/v1/app_events', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        user_id: userId,
        event_type: 'account_deleted',
        metadata: {
          plan: profile.plan || 'free',
          plan_type: subscriptions?.[0]?.plan_type || null,
          had_pro_until: profile.pro_until || null,
          recurring_cancelled: stripeSubscriptions.length > 0
        }
      })
    }).catch(() => {});

    await supabaseFetch(supabaseUrl, serviceKey, `auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE'
    });

    return json(200, {
      deleted: true,
      recurring_cancelled: stripeSubscriptions.length > 0
    });
  } catch (e) {
    return json(500, { error: e.message || 'Account deletion failed.' });
  }
};
