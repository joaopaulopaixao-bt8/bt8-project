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

const parseDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
};

const isActivePro = (profile, now) => (
  profile.plan === 'pro' && (!profile.pro_until || parseDate(profile.pro_until)?.getTime() > now.getTime())
);

const modeLabel = (mode) => ({
  s4: 'Super 4',
  s6: 'Super 6',
  s8: 'Super 8',
  s8x: 'Super 8 Soma X',
  s12: 'Super 12',
  mista: 'Super Mista',
  df: 'Duplas Fixas',
  dm: 'Duplas Mistas',
  da: 'Duplas Aleatorias'
}[mode] || mode || 'Sem modo');

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

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const currentMonthKey = now.toISOString().slice(0, 7);

    const [profiles, subscriptions, tournaments, events, guestUsage] = await Promise.all([
      restRows(supabaseUrl, serviceKey, 'profiles?select=id,email,nome,plan,role,pro_until,subscription_status,created_at&order=created_at.desc&limit=1000'),
      restRows(supabaseUrl, serviceKey, 'subscriptions?select=user_id,plan_type,status,current_period_end,metadata,created_at&order=created_at.desc&limit=1000'),
      restRows(supabaseUrl, serviceKey, 'tournaments?select=id,user_id,mode,category,players,created_at&order=created_at.desc&limit=1000'),
      restRows(supabaseUrl, serviceKey, 'app_events?select=event_type,metadata,created_at&order=created_at.desc&limit=80'),
      restRows(supabaseUrl, serviceKey, `guest_usage?select=month_key,tournaments_created,last_seen_at&month_key=eq.${encodeURIComponent(currentMonthKey)}&limit=1000`)
    ]);

    const latestByUser = new Map();
    for (const sub of subscriptions || []) {
      if (!latestByUser.has(sub.user_id)) latestByUser.set(sub.user_id, sub);
    }

    const activeProfiles = (profiles || []).filter(profile => isActivePro(profile, now));
    const recurringActive = activeProfiles.filter(profile => latestByUser.get(profile.id)?.plan_type === 'recurring').length;
    const oneTimeActive = activeProfiles.filter(profile => latestByUser.get(profile.id)?.plan_type === 'one_time_30d').length;
    const proExpired = (profiles || []).filter(profile =>
      profile.plan === 'pro' && profile.pro_until && parseDate(profile.pro_until)?.getTime() <= now.getTime()
    ).length;
    const freeActive = (profiles || []).filter(profile => !isActivePro(profile, now)).length;

    const paidLast30 = (subscriptions || []).filter(sub => {
      const created = parseDate(sub.created_at);
      return created && created >= last30 && ['paid', 'complete', 'completed', 'active'].includes(sub.status);
    });
    const revenue30 = paidLast30.reduce((sum, sub) => sum + (sub.plan_type === 'recurring' ? 6.9 : 14.9), 0);
    const monthlyRecurringRevenue = recurringActive * 6.9;

    const tournamentsMonth = (tournaments || []).filter(t => parseDate(t.created_at) >= monthStart);
    const modeCounts = {};
    for (const t of tournamentsMonth) modeCounts[t.mode] = (modeCounts[t.mode] || 0) + 1;
    const topModes = Object.entries(modeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([mode, count]) => ({ mode, label: modeLabel(mode), count }));

    const eventCount = (type) => (events || []).filter(event => event.event_type === type).length;
    const guestTournamentCount = (guestUsage || []).reduce((sum, row) => sum + (row.tournaments_created || 0), 0);

    return json(200, {
      generated_at: now.toISOString(),
      stats: {
        users_total: profiles?.length || 0,
        users_new_month: (profiles || []).filter(profile => parseDate(profile.created_at) >= monthStart).length,
        free_active: freeActive,
        pro_recurring_active: recurringActive,
        pro_30d_active: oneTimeActive,
        pro_expired: proExpired,
        mrr_estimated_brl: Number(monthlyRecurringRevenue.toFixed(2)),
        revenue_30d_estimated_brl: Number(revenue30.toFixed(2)),
        tournaments_month: tournamentsMonth.length,
        guest_tournaments_month: guestTournamentCount,
        guest_limit_blocks_recent: eventCount('guest_limit_reached'),
        free_limit_blocks_recent: eventCount('free_limit_reached')
      },
      top_modes: topModes,
      recent_users: (profiles || []).slice(0, 10),
      recent_subscriptions: (subscriptions || []).slice(0, 10),
      recent_events: events || []
    });
  } catch (e) {
    return json(500, { error: e.message || 'Admin dashboard failed.' });
  }
};
