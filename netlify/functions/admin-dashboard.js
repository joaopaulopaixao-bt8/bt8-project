const { stripeRequest } = require('./lib/stripe');

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
    const error = new Error(message);
    error.status = res.status;
    error.code = data?.code || null;
    throw error;
  }
  return data;
};

const restRows = async (url, key, path) => supabaseFetch(url, key, `rest/v1/${path}`);

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'GET') return json(405, { error: 'Método não permitido.' });

  const supabaseUrl = process.env.BT8_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.BT8_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.BT8_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  if (!supabaseUrl || !serviceKey) {
    return json(500, {
      error: 'Painel Admin não configurado no servidor.',
      missing: [
        !supabaseUrl ? 'BT8_SUPABASE_URL' : null,
        !serviceKey ? 'BT8_SUPABASE_SERVICE_ROLE_KEY' : null
      ].filter(Boolean)
    });
  }

  const token = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Faça login para abrir o painel.' });

  try {
    const authUser = await supabaseFetch(supabaseUrl, serviceKey, 'auth/v1/user', {
      method: 'GET',
      authorization: `Bearer ${token}`
    }).catch(e => {
      if (e.status === 401 || e.status === 403) return null;
      throw e;
    });
    const userId = authUser?.id;
    if (!userId) return json(401, { error: 'Sessão expirada. Faça login de novo.' });

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
    // PGRST202/42883: a migração 003 ainda não foi aplicada neste banco.
    if (e.code === 'PGRST202' || e.code === '42883') {
      return json(503, { error: 'Painel em atualização: falta instalar as funções do banco (migração 003). Os dados voltam assim que ela for aplicada.' });
    }
    console.error('admin-dashboard:', e.code || '', e.message);
    return json(500, { error: 'Não foi possível carregar o painel agora. Tente de novo em instantes.' });
  }
};
