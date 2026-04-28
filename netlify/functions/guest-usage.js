const crypto = require('crypto');

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type'
  },
  body: JSON.stringify(body)
});

const monthKey = () => new Date().toISOString().slice(0, 7);

const hashValue = (secret, value) => crypto
  .createHash('sha256')
  .update(`${secret}:${value || 'unknown'}`)
  .digest('hex');

const supabaseFetch = async (url, key, path, options = {}) => {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = data?.message || data?.hint || text || `Supabase ${res.status}`;
    throw new Error(message);
  }
  return data;
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.BT8_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.BT8_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const hashSecret = process.env.BT8_GUEST_USAGE_HASH_SECRET || process.env.GUEST_USAGE_HASH_SECRET;

  if (!supabaseUrl || !serviceKey || !hashSecret) {
    return json(500, {
      error: 'Guest usage service is not configured.',
      missing: [
        !supabaseUrl ? 'BT8_SUPABASE_URL' : null,
        !serviceKey ? 'BT8_SUPABASE_SERVICE_ROLE_KEY' : null,
        !hashSecret ? 'BT8_GUEST_USAGE_HASH_SECRET' : null
      ].filter(Boolean)
    });
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Invalid JSON body.' });
  }

  const guestId = String(body.guest_id || '').slice(0, 80);
  if (!guestId) return json(400, { error: 'guest_id is required.' });

  const ip = event.headers['x-nf-client-connection-ip'] ||
    event.headers['client-ip'] ||
    (event.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const userAgent = event.headers['user-agent'] || '';
  const key = monthKey();
  const limit = 1;
  const ipHash = hashValue(hashSecret, ip);
  const uaHash = hashValue(hashSecret, userAgent);
  const selectPath = `guest_usage?select=id,tournaments_created&guest_id=eq.${encodeURIComponent(guestId)}&month_key=eq.${encodeURIComponent(key)}&limit=1`;

  try {
    const existing = await supabaseFetch(supabaseUrl, serviceKey, selectPath);
    const current = existing?.[0];

    if (current && current.tournaments_created >= limit) {
      await supabaseFetch(supabaseUrl, serviceKey, 'app_events', {
        method: 'POST',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({
          guest_id: guestId,
          event_type: 'guest_limit_reached',
          metadata: { month_key: key, limit }
        })
      }).catch(() => {});
      return json(200, { allowed: false, used: current.tournaments_created, limit, month_key: key });
    }

    if (current) {
      const next = current.tournaments_created + 1;
      await supabaseFetch(supabaseUrl, serviceKey, `guest_usage?id=eq.${current.id}`, {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({ tournaments_created: next, last_seen_at: new Date().toISOString() })
      });
      return json(200, { allowed: true, used: next, limit, month_key: key });
    }

    await supabaseFetch(supabaseUrl, serviceKey, 'guest_usage', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        guest_id: guestId,
        ip_hash: ipHash,
        user_agent_hash: uaHash,
        month_key: key,
        tournaments_created: 1
      })
    });

    return json(200, { allowed: true, used: 1, limit, month_key: key });
  } catch (e) {
    return json(500, { error: e.message || 'Guest usage validation failed.' });
  }
};
