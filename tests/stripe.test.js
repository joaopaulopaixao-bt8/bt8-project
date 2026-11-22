const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const lib = require('../netlify/functions/lib/stripe');

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-22T12:00:00Z');

test('Pro 30 dias soma a partir do vencimento atual quando ainda está valendo', () => {
  assert.equal(lib.extendOneTimeProUntil('2026-12-01T12:00:00Z', now), '2026-12-31T12:00:00.000Z');
});

test('Pro 30 dias conta a partir de agora quando não há Pro ou já venceu', () => {
  assert.equal(lib.extendOneTimeProUntil(null, now), new Date(now.getTime() + 30 * DAY).toISOString());
  assert.equal(lib.extendOneTimeProUntil('2026-01-01T00:00:00Z', now), new Date(now.getTime() + 30 * DAY).toISOString());
});

test('reembolso do 30 dias tira só os 30 dias daquela compra', () => {
  assert.equal(lib.revokeOneTimeProUntil('2026-12-31T12:00:00Z', now), '2026-12-01T12:00:00.000Z');
  assert.equal(lib.revokeOneTimeProUntil('2026-12-10T12:00:00Z', now), null);
  assert.equal(lib.revokeOneTimeProUntil(null, now), null);
});

test('só libera Pro com payment_status paid ou no_payment_required', () => {
  assert.equal(lib.isCheckoutPaid({ payment_status: 'paid' }), true);
  assert.equal(lib.isCheckoutPaid({ payment_status: 'no_payment_required' }), true);
  assert.equal(lib.isCheckoutPaid({ payment_status: 'unpaid' }), false);
  assert.equal(lib.isCheckoutPaid({}), false);
});

test('plano deriva do status da assinatura', () => {
  for (const s of ['active', 'trialing', 'past_due']) assert.equal(lib.planForSubscriptionStatus(s), 'pro');
  for (const s of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) assert.equal(lib.planForSubscriptionStatus(s), 'free');
});

test('assinatura sem current_period_end dá erro em vez de null', () => {
  assert.equal(lib.subscriptionPeriodEnd({ current_period_end: 1800000000 }), new Date(1800000000 * 1000).toISOString());
  assert.equal(lib.subscriptionPeriodEnd({ items: { data: [{ current_period_end: 1800000000 }] } }), new Date(1800000000 * 1000).toISOString());
  assert.throws(() => lib.subscriptionPeriodEnd({ id: 'sub_1' }), /current_period_end/);
});

test('mensal ativo bloqueia nova compra; mensal com cancelamento agendado não', () => {
  const row = { plan_type: 'recurring', stripe_subscription_id: 'sub_1', status: 'active', metadata: {} };
  assert.equal(lib.isRecurringActive(row), true);
  assert.equal(lib.isRecurringActive({ ...row, status: 'canceled' }), false);
  assert.equal(lib.isRecurringActive({ ...row, metadata: { cancel_at_period_end: true } }), false);
  assert.equal(lib.isRecurringActive(null), false);
});

test('origin do checkout só aceita domínios da lista', () => {
  const allowed = lib.allowedOrigins({ DEPLOY_PRIME_URL: 'https://preview--bt8.netlify.app/' });
  assert.equal(lib.resolveOrigin('https://bt8.com.br/', allowed), 'https://bt8.com.br');
  assert.equal(lib.resolveOrigin('https://preview--bt8.netlify.app', allowed), 'https://preview--bt8.netlify.app');
  assert.equal(lib.resolveOrigin('https://evil.example', allowed), null);
  assert.equal(lib.resolveOrigin('https://bt8.com.br.evil.example', allowed), null);
  assert.equal(lib.resolveOrigin('', allowed), null);
});

// ---- webhook end to end with fetch stubbed (Supabase REST + Stripe API) ----

const SECRET = 'webhook-secret-for-tests';

const signedEvent = (payload) => {
  const body = JSON.stringify(payload);
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
  return { httpMethod: 'POST', headers: { 'stripe-signature': `t=${t},v1=${v1}` }, body };
};

// Minimal fake: profiles/subscriptions/app_events tables plus canned Stripe objects.
const fakeBackend = ({ profiles = [], subscriptions = [], events = [], stripe = {} }) => {
  const calls = [];
  const db = { profiles, subscriptions, app_events: events };
  const filtersOf = (query) => [...query.entries()].filter(([k]) => !['select', 'order', 'limit'].includes(k));
  const matches = (row, filters) => filters.every(([k, v]) => {
    const value = k.includes('->>') ? row[k.split('->>')[0]]?.[k.split('->>')[1]] : row[k];
    if (v.startsWith('eq.')) return String(value) === v.slice(3);
    if (v === 'not.is.null') return value != null;
    return true;
  });
  global.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    calls.push({ method, url: u.pathname + u.search, body: init.body ? String(init.body) : null });
    const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data, text: async () => (data == null ? '' : JSON.stringify(data)) });
    if (u.hostname === 'api.stripe.com') {
      const key = `${method} ${u.pathname.replace('/v1/', '')}`;
      return key in stripe ? reply(stripe[key]) : reply({ error: { message: 'No such object', code: 'resource_missing' } }, 404);
    }
    const table = u.pathname.replace('/rest/v1/', '');
    const rows = db[table];
    const filters = filtersOf(u.searchParams);
    if (method === 'GET') return reply(rows.filter(r => matches(r, filters)));
    if (method === 'POST') { rows.push({ id: `${table}_${rows.length + 1}`, ...JSON.parse(init.body) }); return reply(null, 201); }
    if (method === 'PATCH') { rows.filter(r => matches(r, filters)).forEach(r => Object.assign(r, JSON.parse(init.body))); return reply(null, 204); }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { db, calls };
};

const runWebhook = async (payload) => {
  Object.assign(process.env, {
    BT8_SUPABASE_URL: 'http://supabase.test',
    BT8_SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    BT8_STRIPE_SECRET_KEY: 'stripe-key-for-tests',
    BT8_STRIPE_WEBHOOK_SECRET: SECRET
  });
  const { handler } = require('../netlify/functions/stripe-webhook');
  const res = await handler(signedEvent(payload));
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

const realFetch = global.fetch;
test.afterEach(() => { global.fetch = realFetch; });

const session = (extra) => ({
  id: 'cs_1', object: 'checkout.session', mode: 'payment', customer: 'cus_1', client_reference_id: 'u1',
  payment_intent: 'pi_1', metadata: { user_id: 'u1', plan_type: 'one_time_30d' }, ...extra
});

test('webhook: checkout pago soma 30 dias e casa com o registro checkout_started', async () => {
  const proUntil = new Date(Date.now() + 10 * DAY).toISOString();
  const { db } = fakeBackend({
    profiles: [{ id: 'u1', role: 'user', pro_until: proUntil, stripe_customer_id: 'cus_1' }],
    subscriptions: [{ id: 's1', user_id: 'u1', status: 'checkout_started', metadata: { checkout_session_id: 'cs_1' } }]
  });
  const res = await runWebhook({ id: 'evt_1', type: 'checkout.session.completed', data: { object: session({ payment_status: 'paid' }) } });
  assert.equal(res.status, 200);
  assert.equal(db.profiles[0].plan, 'pro');
  assert.equal(new Date(db.profiles[0].pro_until).getTime(), new Date(proUntil).getTime() + 30 * DAY);
  assert.equal(db.subscriptions.length, 1);
  assert.equal(db.subscriptions[0].status, 'paid');
  assert.equal(db.subscriptions[0].stripe_payment_intent_id, 'pi_1');
});

test('webhook: checkout ainda não pago não libera Pro; async_payment_succeeded libera', async () => {
  const { db } = fakeBackend({ profiles: [{ id: 'u1', role: 'user', pro_until: null, stripe_customer_id: 'cus_1' }] });
  await runWebhook({ id: 'evt_a', type: 'checkout.session.completed', data: { object: session({ payment_status: 'unpaid' }) } });
  assert.equal(db.profiles[0].plan, undefined);
  assert.equal(db.subscriptions[0].status, 'payment_pending');

  await runWebhook({ id: 'evt_b', type: 'checkout.session.async_payment_succeeded', data: { object: session({ payment_status: 'paid' }) } });
  assert.equal(db.profiles[0].plan, 'pro');
  assert.equal(db.subscriptions.length, 1);
  assert.equal(db.subscriptions[0].status, 'paid');
});

test('webhook: mesmo event.id duas vezes não soma 30 dias de novo', async () => {
  const { db } = fakeBackend({ profiles: [{ id: 'u1', role: 'user', pro_until: null, stripe_customer_id: 'cus_1' }] });
  const payload = { id: 'evt_dup', type: 'checkout.session.completed', data: { object: session({ payment_status: 'paid' }) } };
  await runWebhook(payload);
  const first = db.profiles[0].pro_until;
  const res = await runWebhook(payload);
  assert.equal(res.body.duplicate, 'event_id');
  assert.equal(db.profiles[0].pro_until, first);
});

test('webhook: checkout.session.expired marca o registro órfão', async () => {
  const { db } = fakeBackend({
    subscriptions: [{ id: 's1', user_id: 'u1', status: 'checkout_started', metadata: { checkout_session_id: 'cs_1' } }]
  });
  await runWebhook({ id: 'evt_x', type: 'checkout.session.expired', data: { object: session({ status: 'expired' }) } });
  assert.equal(db.subscriptions[0].status, 'expired');
});

test('webhook: reembolso total do 30 dias revoga só aqueles 30 dias, e disputa depois não revoga de novo', async () => {
  const proUntil = new Date(Date.now() + 40 * DAY).toISOString();
  const { db } = fakeBackend({
    profiles: [{ id: 'u1', role: 'user', pro_until: proUntil, stripe_customer_id: 'cus_1' }],
    subscriptions: [{ id: 's1', user_id: 'u1', status: 'paid', stripe_payment_intent_id: 'pi_1', metadata: {} }],
    stripe: { 'GET charges/ch_1': { id: 'ch_1', customer: 'cus_1', payment_intent: 'pi_1', invoice: null } }
  });
  const charge = { id: 'ch_1', customer: 'cus_1', payment_intent: 'pi_1', invoice: null, refunded: true, amount: 1990, amount_refunded: 1990 };
  await runWebhook({ id: 'evt_r', type: 'charge.refunded', data: { object: charge } });
  assert.equal(db.profiles[0].plan, 'pro');
  assert.equal(new Date(db.profiles[0].pro_until).getTime(), new Date(proUntil).getTime() - 30 * DAY);
  assert.equal(db.subscriptions[0].status, 'refunded');

  const res = await runWebhook({ id: 'evt_d', type: 'charge.dispute.created', data: { object: { id: 'dp_1', charge: 'ch_1' } } });
  assert.equal(res.body.duplicate, 'already_revoked');
  assert.equal(new Date(db.profiles[0].pro_until).getTime(), new Date(proUntil).getTime() - 30 * DAY);
});

test('webhook: reembolso parcial não revoga', async () => {
  const proUntil = new Date(Date.now() + 20 * DAY).toISOString();
  const { db } = fakeBackend({ profiles: [{ id: 'u1', role: 'user', pro_until: proUntil, stripe_customer_id: 'cus_1' }] });
  const res = await runWebhook({ id: 'evt_p', type: 'charge.refunded', data: { object: { id: 'ch_1', customer: 'cus_1', refunded: false, amount: 1990, amount_refunded: 500 } } });
  assert.equal(res.body.ignored, 'partial_refund');
  assert.equal(db.profiles[0].pro_until, proUntil);
});

test('webhook: disputa no mensal cancela a assinatura no Stripe e tira o Pro', async () => {
  const { db, calls } = fakeBackend({
    profiles: [{ id: 'u1', role: 'user', pro_until: new Date(Date.now() + 20 * DAY).toISOString(), stripe_customer_id: 'cus_1', plan: 'pro' }],
    subscriptions: [{ id: 's1', user_id: 'u1', status: 'active', stripe_subscription_id: 'sub_1', metadata: {} }],
    stripe: {
      'GET charges/ch_2': { id: 'ch_2', customer: 'cus_1', invoice: 'in_1' },
      'GET invoices/in_1': { id: 'in_1', subscription: 'sub_1' },
      'DELETE subscriptions/sub_1': { id: 'sub_1', status: 'canceled' }
    }
  });
  await runWebhook({ id: 'evt_dm', type: 'charge.dispute.created', data: { object: { id: 'dp_2', charge: 'ch_2' } } });
  assert.ok(calls.some(c => c.method === 'DELETE' && c.url.includes('/v1/subscriptions/sub_1')));
  assert.equal(db.profiles[0].plan, 'free');
  assert.equal(db.profiles[0].pro_until, null);
  assert.equal(db.subscriptions[0].status, 'disputed');
});

test('webhook: subscription.updated past_due mantém Pro; unpaid tira', async () => {
  const end = Math.floor(Date.now() / 1000) + 10 * 86400;
  const sub = (status) => ({ id: 'sub_1', customer: 'cus_1', status, current_period_end: end, items: { data: [] } });
  const stripe = { 'GET subscriptions/sub_1': sub('past_due') };
  const { db } = fakeBackend({ profiles: [{ id: 'u1', role: 'user', pro_until: null, stripe_customer_id: 'cus_1' }], stripe });
  await runWebhook({ id: 'evt_u1', type: 'customer.subscription.updated', data: { object: sub('past_due') } });
  assert.equal(db.profiles[0].plan, 'pro');
  assert.equal(db.profiles[0].pro_until, new Date(end * 1000).toISOString());

  stripe['GET subscriptions/sub_1'] = sub('unpaid');
  await runWebhook({ id: 'evt_u2', type: 'customer.subscription.updated', data: { object: sub('unpaid') } });
  assert.equal(db.profiles[0].plan, 'free');
  assert.equal(db.profiles[0].pro_until, null);
});

test('webhook: assinatura recorrente sem current_period_end responde 500 (Stripe reenvia)', async () => {
  fakeBackend({
    profiles: [{ id: 'u1', role: 'user', pro_until: null, stripe_customer_id: 'cus_1' }],
    stripe: { 'GET subscriptions/sub_1': { id: 'sub_1', customer: 'cus_1', status: 'active', items: { data: [] } } }
  });
  const res = await runWebhook({ id: 'evt_np', type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1' } } });
  assert.equal(res.status, 500);
});

test('webhook lista os mesmos eventos documentados em docs/STRIPE_PRODUCAO.md', () => {
  const doc = require('node:fs').readFileSync(require('node:path').join(__dirname, '../docs/STRIPE_PRODUCAO.md'), 'utf8');
  const { HANDLED_EVENTS } = require('../netlify/functions/stripe-webhook');
  for (const type of HANDLED_EVENTS) assert.ok(doc.includes(`\`${type}\``), `${type} não está no doc`);
});

// ---- create-checkout ----

const runCheckout = async (body) => {
  Object.assign(process.env, {
    BT8_SUPABASE_URL: 'http://supabase.test',
    BT8_SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    BT8_STRIPE_SECRET_KEY: 'stripe-key-for-tests',
    BT8_STRIPE_PRO_MONTHLY_PRICE_ID: 'price_monthly',
    BT8_STRIPE_PRO_30D_PRICE_ID: 'price_30d'
  });
  const { handler } = require('../netlify/functions/create-checkout');
  const res = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer user-jwt' }, body: JSON.stringify(body) });
  return { status: res.statusCode, body: JSON.parse(res.body) };
};

const withAuth = (backend) => {
  const inner = global.fetch;
  global.fetch = async (url, init) => (String(url).includes('/auth/v1/user')
    ? { ok: true, status: 200, text: async () => JSON.stringify({ id: 'u1', email: 'u1@example.com' }) }
    : inner(url, init));
  return backend;
};

test('checkout: recusa o 30 dias com 409 quando há mensal ativo', async () => {
  withAuth(fakeBackend({
    profiles: [{ id: 'u1', role: 'user', plan: 'pro', stripe_customer_id: 'cus_1' }],
    subscriptions: [{ id: 's1', user_id: 'u1', plan_type: 'recurring', status: 'active', stripe_subscription_id: 'sub_1', metadata: {} }]
  }));
  const res = await runCheckout({ plan: 'pro_30d', origin: 'https://bt8.com.br' });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /assinatura mensal está ativa/);
});

test('checkout: recusa origin fora da lista', async () => {
  withAuth(fakeBackend({ profiles: [{ id: 'u1', role: 'user' }] }));
  const res = await runCheckout({ plan: 'pro_30d', origin: 'https://evil.example' });
  assert.equal(res.status, 400);
});

test('checkout: só cartão, pt-BR, aceite dos termos e cliente recriado se o de teste não existir', async () => {
  const { calls } = withAuth(fakeBackend({
    profiles: [{ id: 'u1', role: 'user', stripe_customer_id: 'cus_test_old' }],
    stripe: { 'POST customers': { id: 'cus_live_new' } }
  }));
  let sessionCalls = 0;
  const inner = global.fetch;
  global.fetch = async (url, init) => {
    if (String(url).endsWith('/v1/checkout/sessions')) {
      sessionCalls += 1;
      calls.push({ method: 'POST', url: '/v1/checkout/sessions', body: String(init.body) });
      const params = new URLSearchParams(String(init.body));
      if (params.get('customer') === 'cus_test_old') {
        return { ok: false, status: 400, json: async () => ({ error: { code: 'resource_missing', param: 'customer', message: 'No such customer' } }) };
      }
      return { ok: true, status: 200, json: async () => ({ id: 'cs_new', url: 'https://checkout.stripe.test/cs_new' }) };
    }
    return inner(url, init);
  };
  const res = await runCheckout({ plan: 'pro_30d', origin: 'https://bt8.com.br' });
  assert.equal(res.status, 200);
  assert.equal(sessionCalls, 2);
  const params = new URLSearchParams(calls.filter(c => c.url === '/v1/checkout/sessions').pop().body);
  assert.equal(params.get('customer'), 'cus_live_new');
  assert.equal(params.get('payment_method_types[0]'), 'card');
  assert.equal(params.get('locale'), 'pt-BR');
  assert.equal(params.get('consent_collection[terms_of_service]'), 'required');
  assert.match(params.get('custom_text[submit][message]'), /7 dias/);
  assert.ok(params.get('success_url').startsWith('https://bt8.com.br/'));
});
