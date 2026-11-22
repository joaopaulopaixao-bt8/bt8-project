const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'authorization'
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

const restRows = async (url, key, path) => supabaseFetch(url, key, `rest/v1/${path}`);

const stripeRequest = async (secretKey, path, options = {}) => {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: options.method || 'GET',
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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.BT8_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.BT8_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.BT8_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  if (!supabaseUrl || !serviceKey) {
    return json(500, {
      error: 'Admin service is not configured.',
      missing: [
        !supabaseUrl ? 'BT8_SUPABASE_URL' : null,
        !serviceKey ? 'BT8_SUPABASE_SERVICE_ROLE_KEY' : null
      ].filter(Boolean)
    });
  }

  const token = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Login required.' });

  try {
    const authUser = await supabaseFetch(supabaseUrl, serviceKey, 'auth/v1/user', {
      method: 'GET',
      authorization: `Bearer ${token}`
    });
    const userId = authUser?.id;
    if (!userId) return json(401, { error: 'Invalid session.' });

    const adminRows = await restRows(
      supabaseUrl,
      serviceKey,
      `profiles?select=id,email,role,stripe_customer_id&id=eq.${encodeURIComponent(userId)}&limit=1`
    );
    const adminProfile = adminRows?.[0];
    if (adminProfile?.role !== 'admin') return json(403, { error: 'Acesso restrito.' });

    if (stripeKey) {
      const adminSubs = await restRows(
        supabaseUrl,
        serviceKey,
        `subscriptions?select=id,stripe_subscription_id,status&user_id=eq.${encodeURIComponent(userId)}&stripe_subscription_id=not.is.null&limit=20`
      ).catch(() => []);
      for (const sub of adminSubs || []) {
        if (sub.stripe_subscription_id) {
          await stripeRequest(stripeKey, `subscriptions/${sub.stripe_subscription_id}`, { method: 'DELETE' })
            .catch(() => {});
        }
        await supabaseFetch(supabaseUrl, serviceKey, `rest/v1/subscriptions?id=eq.${sub.id}`, {
          method: 'PATCH',
          headers: { prefer: 'return=minimal' },
          body: JSON.stringify({
            status: 'admin_blocked',
            current_period_end: null,
            metadata: { admin_blocked: true, cleaned_from_admin_dashboard: true },
            updated_at: new Date().toISOString()
          })
        }).catch(() => {});
      }
      await supabaseFetch(supabaseUrl, serviceKey, `rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({
          plan: 'free',
          pro_until: null,
          subscription_status: 'admin_no_plan',
          updated_at: new Date().toISOString()
        })
      }).catch(() => {});
    }

    // Os números saem das funções agregadas da migração 003 (só a service role executa).
    const rpc = (name, args) => supabaseFetch(supabaseUrl, serviceKey, `rest/v1/rpc/${name}`, {
      method: 'POST',
      body: JSON.stringify(args)
    });
    const query = event.queryStringParameters || {};

    if (query.view === 'customers') {
      const search = String(query.q || '').trim().slice(0, 80);
      return json(200, { customers: await rpc('admin_customers', { p_search: search || null, p_limit: 100 }) });
    }

    if (query.view === 'customer') {
      if (!/^[0-9a-f-]{36}$/i.test(query.id || '')) return json(400, { error: 'Cliente inválido.' });
      return json(200, await rpc('admin_customer', { p_user_id: query.id }));
    }

    const period = ['7d', '30d', 'mes'].includes(query.period) ? query.period : 'mes';
    const dashboard = await rpc('admin_dashboard', { p_period: period });
    return json(200, {
      generated_at: new Date().toISOString(),
      ...dashboard,
      // Sem fonte de dados ainda: o painel mostra "não configurado".
      ops: { last_backup_at: null, uptime: null }
    });
  } catch (e) {
    return json(500, { error: e.message || 'Admin dashboard failed.' });
  }
};
