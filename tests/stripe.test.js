const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const lib = require('../netlify/functions/lib/stripe');

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-22T12:00:00Z');

test('Pro 30 dias soma a partir do vencimento atual quando ainda está valendo', () => {
  assert.deepEqual(lib.oneTimeGrant('2026-12-01T12:00:00Z', now), { start: '2026-12-01T12:00:00.000Z', end: '2026-12-31T12:00:00.000Z' });
});

test('Pro 30 dias conta a partir de agora quando não há Pro ou já venceu', () => {
  const expected = { start: now.toISOString(), end: new Date(now.getTime() + 30 * DAY).toISOString() };
  assert.deepEqual(lib.oneTimeGrant(null, now), expected);
  assert.deepEqual(lib.oneTimeGrant('2026-01-01T00:00:00Z', now), expected);
});

test('reembolso tira só o que sobra daquele passe: max(0, fim - max(início, agora))', () => {
  // Passe ainda não começou (empilhado depois de outro): tira os 30 dias inteiros.
  const future = { start: '2026-12-01T12:00:00Z', end: '2026-12-31T12:00:00Z' };
  assert.equal(lib.revokeOneTimeProUntil('2026-12-31T12:00:00Z', future, now), '2026-12-01T12:00:00.000Z');
  // Passe em uso há 20 dias: tira só os 10 que faltam.
  const running = { start: new Date(now.getTime() - 20 * DAY).toISOString(), end: new Date(now.getTime() + 10 * DAY).toISOString() };
  assert.equal(lib.revokeOneTimeProUntil(new Date(now.getTime() + 40 * DAY).toISOString(), running, now), new Date(now.getTime() + 30 * DAY).toISOString());
  // Passe antigo, já vencido: não tira nada.
  const old = { start: '2026-01-01T00:00:00Z', end: '2026-01-31T00:00:00Z' };
  assert.equal(lib.unusedGrantMs(old, now), 0);
  assert.equal(lib.revokeOneTimeProUntil('2026-12-10T12:00:00Z', old, now), '2026-12-10T12:00:00.000Z');
  // Registro antigo sem intervalo: conta 30 dias.
  assert.equal(lib.revokeOneTimeProUntil('2026-12-10T12:00:00Z', null, now), null);
  assert.equal(lib.revokeOneTimeProUntil(null, running, now), null);
});

test('past_due mantém Pro só por uma carência curta depois do início do período', () => {
  const start = Math.floor(now.getTime() / 1000);
  const sub = { status: 'past_due', current_period_start: start, current_period_end: start + 30 * 86400 };
  assert.equal(lib.subscriptionProUntil(sub), new Date((start + lib.PAST_DUE_GRACE_DAYS * 86400) * 1000).toISOString());
  assert.equal(lib.subscriptionProUntil({ ...sub, status: 'active' }), new Date((start + 30 * 86400) * 1000).toISOString());
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
// `fail({ method, path, body })` returning true makes that request answer 500 (to simulate
// the database or Stripe failing in the middle of a webhook).
const fakeBackend = ({ profiles = [], subscriptions = [], events = [], stripe = {}, fail = null }) => {
  const calls = [];
  let seq = 0;
  const db = { profiles, subscriptions, app_events: events };
  const filtersOf = (query) => [...query.entries()].filter(([k]) => !['select', 'order', 'limit'].includes(k));
  const matches = (row, filters) => filters.every(([k, v]) => {
    const value = k.includes('->>') ? row[k.split('->>')[0]]?.[k.split('->>')[1]] : row[k];
    if (v.startsWith('eq.')) return String(value) === v.slice(3);
    if (v.startsWith('neq.')) return String(value) !== v.slice(4);
    if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(value));
    if (v.startsWith('gt.')) return value != null && new Date(value) > new Date(v.slice(3));
    if (v === 'not.is.null') return value != null;
    return true;
  });
  global.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    calls.push({ method, url: u.pathname + u.search, body: init.body ? String(init.body) : null });
    const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data, text: async () => (data == null ? '' : JSON.stringify(data)) });
    if (fail && fail({ method, path: decodeURIComponent(u.pathname + u.search), body: init.body ? String(init.body) : '' })) {
      return reply({ message: 'simulated failure' }, 500);
    }
    if (u.hostname === 'api.stripe.com') {
      const key = `${method} ${u.pathname.replace('/v1/', '')}`;
      return key in stripe ? reply(stripe[key]) : reply({ error: { message: 'No such object', code: 'resource_missing' } }, 404);
    }
    const table = u.pathname.replace('/rest/v1/', '');
    const rows = db[table];
    const filters = filtersOf(u.searchParams);
    if (method === 'GET') return reply(rows.filter(r => matches(r, filters)));
    if (method === 'POST') {
      const row = { id: `${table}_${++seq}`, ...JSON.parse(init.body) };
      // Same unique index the docs ask for: one stripe_event_processed per event_id.
      if (table === 'app_events' && row.event_type === 'stripe_event_processed'
        && rows.some(e => e.event_type === row.event_type && e.metadata?.event_id === row.metadata?.event_id)) {
        return reply({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409);
      }
      rows.push(row);
      return reply([row], 201);
    }
    if (method === 'PATCH') {
      const hit = rows.filter(r => matches(r, filters));
      hit.forEach(r => Object.assign(r, JSON.parse(init.body)));
      return reply(hit, 200);
    }
    if (method === 'DELETE') {
      const keep = rows.filter(r => !matches(r, filters));
      rows.length = 0;
      rows.push(...keep);
      return reply(null, 204);
    }
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
      'GET subscriptions/sub_1': { id: 'sub_1', status: 'active' },
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

// ---- revisão do PR #9 ----

const iso = (ms) => new Date(ms).toISOString();

test('cenário 1: deleted do mensal com cancelamento agendado não apaga o 30 dias comprado depois', async () => {
  const D = Date.now() + 5 * DAY;
  const { db } = fakeBackend({
    profiles: [{ id: 'u1', role: 'user', plan: 'pro', pro_until: iso(D + 30 * DAY), stripe_customer_id: 'cus_1' }],
    subscriptions: [
      { id: 's_old', user_id: 'u1', plan_type: 'recurring', status: 'cancel_at_period_end', stripe_subscription_id: 'sub_old', current_period_end: iso(D), metadata: {} },
      { id: 's_pass', user_id: 'u1', plan_type: 'one_time_30d', status: 'paid', stripe_payment_intent_id: 'pi_1', current_period_end: iso(D + 30 * DAY), metadata: { granted_start: iso(D), granted_end: iso(D + 30 * DAY) } }
    ]
  });
  await runWebhook({ id: 'evt_del', type: 'customer.subscription.deleted', data: { object: { id: 'sub_old', customer: 'cus_1', status: 'canceled', current_period_end: Math.floor(D / 1000) } } });
  assert.equal(db.profiles[0].plan, 'pro');
  assert.equal(new Date(db.profiles[0].pro_until).getTime(), D + 30 * DAY);
  assert.equal(db.subscriptions[0].status, 'canceled');
});

test('cenário 1: deleted da assinatura antiga não derruba o mensal novo', async () => {
  const E2 = Date.now() + 25 * DAY;
  const { db } = fakeBackend({
    profiles: [{ id: 'u1', role: 'user', plan: 'pro', pro_until: iso(E2), stripe_customer_id: 'cus_1' }],
    subscriptions: [
      { id: 's_old', user_id: 'u1', plan_type: 'recurring', status: 'cancel_at_period_end', stripe_subscription_id: 'sub_old', current_period_end: iso(Date.now() + DAY), metadata: {} },
      { id: 's_new', user_id: 'u1', plan_type: 'recurring', status: 'active', stripe_subscription_id: 'sub_new', current_period_end: iso(E2), metadata: {} }
    ]
  });
  await runWebhook({ id: 'evt_del2', type: 'customer.subscription.deleted', data: { object: { id: 'sub_old', customer: 'cus_1', status: 'canceled' } } });
  assert.equal(db.profiles[0].plan, 'pro');
  assert.equal(new Date(db.profiles[0].pro_until).getTime(), E2);
  assert.equal(db.profiles[0].subscription_status, 'active');
});

test('cenário 1: updated da assinatura antiga não encurta o pro_until garantido por outro registro', async () => {
  const shortEnd = Math.floor((Date.now() + 2 * DAY) / 1000);
  const passEnd = Date.now() + 20 * DAY;
  const old = { id: 'sub_old', customer: 'cus_1', status: 'active', cancel_at_period_end: true, current_period_end: shortEnd, items: { data: [] } };
  const { db } = fakeBackend({
    profiles: [{ id: 'u1', role: 'user', plan: 'pro', pro_until: iso(passEnd), stripe_customer_id: 'cus_1' }],
    subscriptions: [
      { id: 's_old', user_id: 'u1', plan_type: 'recurring', status: 'active', stripe_subscription_id: 'sub_old', current_period_end: iso(shortEnd * 1000), metadata: {} },
      { id: 's_pass', user_id: 'u1', plan_type: 'one_time_30d', status: 'paid', current_period_end: iso(passEnd), metadata: {} }
    ],
    stripe: { 'GET subscriptions/sub_old': old }
  });
  await runWebhook({ id: 'evt_upd', type: 'customer.subscription.updated', data: { object: old } });
  assert.equal(new Date(db.profiles[0].pro_until).getTime(), passEnd);
  assert.equal(db.subscriptions[0].status, 'cancel_at_period_end');
});

test('cenário 1: sem nenhum outro direito, deleted tira o Pro', async () => {
  const { db } = fakeBackend({
    profiles: [{ id: 'u1', role: 'user', plan: 'pro', pro_until: iso(Date.now() + DAY), stripe_customer_id: 'cus_1' }],
    subscriptions: [{ id: 's_old', user_id: 'u1', plan_type: 'recurring', status: 'active', stripe_subscription_id: 'sub_old', current_period_end: iso(Date.now() + DAY), metadata: {} }]
  });
  await runWebhook({ id: 'evt_del3', type: 'customer.subscription.deleted', data: { object: { id: 'sub_old', customer: 'cus_1', status: 'canceled' } } });
  assert.equal(db.profiles[0].plan, 'free');
  assert.equal(db.profiles[0].pro_until, null);
});

test('cenário 2: duas entregas simultâneas do mesmo evento somam 30 dias uma vez só', async () => {
  const { db } = fakeBackend({ profiles: [{ id: 'u1', role: 'user', pro_until: null, stripe_customer_id: 'cus_1' }] });
  const payload = { id: 'evt_race', type: 'checkout.session.completed', data: { object: session({ payment_status: 'paid' }) } };
  const [a, b] = await Promise.all([runWebhook(payload), runWebhook(payload)]);
  // One processes; the other is either "already done" (200) or "in progress" (409, Stripe retries).
  const processed = [a, b].filter(r => r.status === 200 && !r.body.duplicate);
  assert.equal(processed.length, 1);
  assert.ok([a, b].every(r => r.status === 200 || r.status === 409));
  const until = new Date(db.profiles[0].pro_until).getTime();
  assert.ok(Math.abs(until - (Date.now() + 30 * DAY)) < 60 * 1000, 'somou mais de 30 dias');
  assert.equal(db.app_events.filter(e => e.event_type === 'stripe_event_processed').length, 1);
});

test('cenário 2: se o processamento falha, a reserva é apagada e o reenvio processa', async () => {
  const { db } = fakeBackend({ profiles: [] });
  const payload = { id: 'evt_fail', type: 'checkout.session.completed', data: { object: session({ payment_status: 'paid' }) } };
  const first = await runWebhook(payload);
  assert.equal(first.status, 500);
  assert.equal(db.app_events.filter(e => e.event_type === 'stripe_event_processed').length, 0);
  db.profiles.push({ id: 'u1', role: 'user', pro_until: null, stripe_customer_id: 'cus_1' });
  const retry = await runWebhook(payload);
  assert.equal(retry.status, 200);
  assert.equal(db.profiles[0].plan, 'pro');
});

test('cenário 3: reembolso do passe em uso tira só o que falta dele e puxa o passe seguinte', async () => {
  const t = Date.now();
  const { db } = fakeBackend({
    profiles: [{ id: 'u1', role: 'user', plan: 'pro', pro_until: iso(t + 40 * DAY), stripe_customer_id: 'cus_1' }],
    subscriptions: [
      { id: 's_a', user_id: 'u1', plan_type: 'one_time_30d', status: 'paid', stripe_payment_intent_id: 'pi_a', current_period_end: iso(t + 10 * DAY), metadata: { granted_start: iso(t - 20 * DAY), granted_end: iso(t + 10 * DAY) } },
      { id: 's_b', user_id: 'u1', plan_type: 'one_time_30d', status: 'paid', stripe_payment_intent_id: 'pi_b', current_period_end: iso(t + 40 * DAY), metadata: { granted_start: iso(t + 10 * DAY), granted_end: iso(t + 40 * DAY), stacked_on: 's_a' } }
    ]
  });
  await runWebhook({ id: 'evt_ra', type: 'charge.refunded', data: { object: { id: 'ch_a', customer: 'cus_1', payment_intent: 'pi_a', refunded: true } } });
  const until = new Date(db.profiles[0].pro_until).getTime();
  assert.ok(Math.abs(until - (t + 30 * DAY)) < 60 * 1000, `pro_until ${db.profiles[0].pro_until}`);
  assert.ok(Math.abs(new Date(db.subscriptions[1].current_period_end).getTime() - (t + 30 * DAY)) < 60 * 1000);
  assert.equal(db.subscriptions[0].status, 'refunded');
});

test('cenário 3: reembolso de um passe antigo, já vencido, não mexe no passe atual', async () => {
  const t = Date.now();
  const { db } = fakeBackend({
    profiles: [{ id: 'u1', role: 'user', plan: 'pro', pro_until: iso(t + 25 * DAY), stripe_customer_id: 'cus_1' }],
    subscriptions: [
      { id: 's_old', user_id: 'u1', plan_type: 'one_time_30d', status: 'paid', stripe_payment_intent_id: 'pi_old', current_period_end: iso(t - 40 * DAY), metadata: { granted_start: iso(t - 70 * DAY), granted_end: iso(t - 40 * DAY) } },
      { id: 's_now', user_id: 'u1', plan_type: 'one_time_30d', status: 'paid', stripe_payment_intent_id: 'pi_now', current_period_end: iso(t + 25 * DAY), metadata: { granted_start: iso(t - 5 * DAY), granted_end: iso(t + 25 * DAY) } }
    ]
  });
  await runWebhook({ id: 'evt_rold', type: 'charge.refunded', data: { object: { id: 'ch_old', customer: 'cus_1', payment_intent: 'pi_old', refunded: true } } });
  assert.equal(new Date(db.profiles[0].pro_until).getTime(), t + 25 * DAY);
  assert.equal(db.profiles[0].plan, 'pro');
  assert.equal(db.subscriptions[1].current_period_end, iso(t + 25 * DAY));
});

test('cliente desconhecido: acha o perfil pelo metadata.user_id da assinatura', async () => {
  const end = Math.floor(Date.now() / 1000) + 10 * 86400;
  const sub = { id: 'sub_9', customer: 'cus_unknown', status: 'active', current_period_end: end, metadata: { user_id: 'u1' }, items: { data: [] } };
  const { db } = fakeBackend({
    profiles: [{ id: 'u1', role: 'user', pro_until: null, stripe_customer_id: null }],
    stripe: { 'GET subscriptions/sub_9': sub }
  });
  const res = await runWebhook({ id: 'evt_meta', type: 'customer.subscription.updated', data: { object: sub } });
  assert.equal(res.status, 200);
  assert.equal(db.profiles[0].plan, 'pro');
});

test('cliente desconhecido: acha o perfil pelo user_id gravado no cliente do Stripe', async () => {
  const { db } = fakeBackend({
    profiles: [{ id: 'u1', role: 'user', pro_until: iso(Date.now() + 40 * DAY), stripe_customer_id: 'cus_other' }],
    subscriptions: [{ id: 's1', user_id: 'u1', plan_type: 'one_time_30d', status: 'paid', stripe_payment_intent_id: 'pi_1', metadata: {} }],
    stripe: { 'GET customers/cus_1': { id: 'cus_1', metadata: { user_id: 'u1' } } }
  });
  await runWebhook({ id: 'evt_cus', type: 'charge.refunded', data: { object: { id: 'ch_1', customer: 'cus_1', payment_intent: 'pi_1', refunded: true } } });
  assert.equal(db.subscriptions[0].status, 'refunded');
});

test('manage-subscription: assinatura sumida com modo diferente não é encerrada localmente', async () => {
  const backend = withAuth(fakeBackend({
    profiles: [{ id: 'u1', role: 'user', plan: 'pro', pro_until: iso(Date.now() + 10 * DAY) }],
    subscriptions: [{ id: 's1', user_id: 'u1', plan_type: 'recurring', status: 'active', stripe_subscription_id: 'sub_test', metadata: { livemode: false } }]
  }));
  Object.assign(process.env, { BT8_SUPABASE_URL: 'http://supabase.test', BT8_SUPABASE_SERVICE_ROLE_KEY: 'service-test', BT8_STRIPE_SECRET_KEY: ['sk', 'live', 'testonly'].join('_') });
  const { handler } = require('../netlify/functions/manage-subscription');
  const res = await handler({ httpMethod: 'POST', headers: { authorization: 'Bearer user-jwt' }, body: JSON.stringify({ action: 'cancel_recurring' }) });
  assert.equal(res.statusCode, 409);
  assert.equal(backend.db.subscriptions[0].status, 'active');
  assert.equal(backend.db.profiles[0].plan, 'pro');
});

// ---- segunda revisão: falha no meio do processamento ----

const once = (predicate) => {
  let used = false;
  return (req) => (!used && predicate(req) ? (used = true) : false);
};
const isProfilePatch = (req) => req.method === 'PATCH' && req.path.startsWith('/rest/v1/profiles');
const near = (actual, expected) => Math.abs(new Date(actual).getTime() - expected) < 60 * 1000;
const processedEvents = (db) => db.app_events.filter(e => e.event_type === 'stripe_event_processed');

test('falha no meio do 30 dias: perfil falha, reenvio libera o Pro uma vez só', async () => {
  const { db } = fakeBackend({
    profiles: [{ id: 'u1', role: 'user', pro_until: null, stripe_customer_id: 'cus_1' }],
    fail: once(isProfilePatch)
  });
  const payload = { id: 'evt_g1', type: 'checkout.session.completed', data: { object: session({ payment_status: 'paid' }) } };
  assert.equal((await runWebhook(payload)).status, 500);
  assert.equal(db.profiles[0].plan, undefined);
  assert.equal(db.subscriptions[0].metadata.pro_granted_at, undefined);
  assert.equal(processedEvents(db).length, 0);

  assert.equal((await runWebhook(payload)).status, 200);
  assert.equal(db.profiles[0].plan, 'pro');
  assert.ok(near(db.profiles[0].pro_until, Date.now() + 30 * DAY));
  assert.ok(db.subscriptions[0].metadata.pro_granted_at);
  assert.equal(processedEvents(db)[0].metadata.status, 'done');
});

test('falha no meio do 30 dias: marca final falha, reenvio não soma de novo', async () => {
  const { db } = fakeBackend({
    profiles: [{ id: 'u1', role: 'user', pro_until: null, stripe_customer_id: 'cus_1' }],
    fail: once(req => req.method === 'PATCH' && req.path.startsWith('/rest/v1/subscriptions') && req.body.includes('pro_granted_at'))
  });
  const payload = { id: 'evt_g2', type: 'checkout.session.completed', data: { object: session({ payment_status: 'paid' }) } };
  assert.equal((await runWebhook(payload)).status, 500);
  const afterFirst = db.profiles[0].pro_until;
  assert.equal(db.profiles[0].plan, 'pro');

  assert.equal((await runWebhook(payload)).status, 200);
  assert.equal(db.profiles[0].pro_until, afterFirst);
  assert.ok(db.subscriptions[0].metadata.pro_granted_at);
});

const stackedPasses = (t) => [
  { id: 's_a', user_id: 'u1', plan_type: 'one_time_30d', status: 'paid', stripe_payment_intent_id: 'pi_a', current_period_end: iso(t + 10 * DAY), metadata: { granted_start: iso(t - 20 * DAY), granted_end: iso(t + 10 * DAY) } },
  { id: 's_b', user_id: 'u1', plan_type: 'one_time_30d', status: 'paid', stripe_payment_intent_id: 'pi_b', current_period_end: iso(t + 40 * DAY), metadata: { granted_start: iso(t + 10 * DAY), granted_end: iso(t + 40 * DAY), stacked_on: 's_a' } }
];
const refundA = { id: 'evt_rf', type: 'charge.refunded', data: { object: { id: 'ch_a', customer: 'cus_1', payment_intent: 'pi_a', refunded: true } } };

for (const [label, predicate] of [
  ['perfil', isProfilePatch],
  ['status final', req => req.method === 'PATCH' && req.path.startsWith('/rest/v1/subscriptions?id=eq.s_a') && req.body.includes('"status":"refunded"')],
  ['deslocamento do passe seguinte', req => req.method === 'PATCH' && req.path.startsWith('/rest/v1/subscriptions?id=eq.s_b')]
]) {
  test(`falha no meio do reembolso (${label}): reenvio termina sem puxar o passe duas vezes`, async () => {
    const t = Date.now();
    const { db } = fakeBackend({
      profiles: [{ id: 'u1', role: 'user', plan: 'pro', pro_until: iso(t + 40 * DAY), stripe_customer_id: 'cus_1' }],
      subscriptions: stackedPasses(t),
      fail: once(predicate)
    });
    assert.equal((await runWebhook(refundA)).status, 500);
    assert.notEqual(db.subscriptions[0].status, 'refunded');

    assert.equal((await runWebhook(refundA)).status, 200);
    assert.equal(db.subscriptions[0].status, 'refunded');
    assert.ok(near(db.subscriptions[1].current_period_end, t + 30 * DAY), `passe B: ${db.subscriptions[1].current_period_end}`);
    assert.ok(near(db.profiles[0].pro_until, t + 30 * DAY), `perfil: ${db.profiles[0].pro_until}`);
    assert.deepEqual(db.subscriptions[1].metadata.shifted_by_refund_of, ['s_a']);
  });
}

test('falha no meio da disputa do mensal: reenvio não cancela de novo e termina', async () => {
  const stripe = {
    'GET charges/ch_2': { id: 'ch_2', customer: 'cus_1', invoice: 'in_1' },
    'GET invoices/in_1': { id: 'in_1', subscription: 'sub_1' },
    'GET subscriptions/sub_1': { id: 'sub_1', status: 'active' },
    'DELETE subscriptions/sub_1': { id: 'sub_1', status: 'canceled' }
  };
  const { db, calls } = fakeBackend({
    profiles: [{ id: 'u1', role: 'user', plan: 'pro', pro_until: iso(Date.now() + 20 * DAY), stripe_customer_id: 'cus_1' }],
    subscriptions: [{ id: 's1', user_id: 'u1', plan_type: 'recurring', status: 'active', stripe_subscription_id: 'sub_1', current_period_end: iso(Date.now() + 20 * DAY), metadata: {} }],
    stripe,
    fail: once(isProfilePatch)
  });
  const payload = { id: 'evt_dm2', type: 'charge.dispute.created', data: { object: { id: 'dp_2', charge: 'ch_2' } } };
  assert.equal((await runWebhook(payload)).status, 500);
  assert.equal(db.subscriptions[0].status, 'active');
  stripe['GET subscriptions/sub_1'] = { id: 'sub_1', status: 'canceled' };

  assert.equal((await runWebhook(payload)).status, 200);
  assert.equal(calls.filter(c => c.method === 'DELETE' && c.url.includes('/v1/subscriptions/sub_1')).length, 1);
  assert.equal(db.profiles[0].plan, 'free');
  assert.equal(db.subscriptions[0].status, 'disputed');
});

test('reembolso do passe A não puxa o passe B que começou no fim do mensal', async () => {
  const t = Date.now();
  const M = t + 15 * DAY;
  const { db } = fakeBackend({
    profiles: [{ id: 'u1', role: 'user', plan: 'pro', pro_until: iso(M + 30 * DAY), stripe_customer_id: 'cus_1' }],
    subscriptions: [
      { id: 's_a', user_id: 'u1', plan_type: 'one_time_30d', status: 'paid', stripe_payment_intent_id: 'pi_a', current_period_end: iso(t + 10 * DAY), metadata: { granted_start: iso(t - 20 * DAY), granted_end: iso(t + 10 * DAY) } },
      { id: 's_m', user_id: 'u1', plan_type: 'recurring', status: 'cancel_at_period_end', stripe_subscription_id: 'sub_m', current_period_end: iso(M), metadata: {} },
      { id: 's_b', user_id: 'u1', plan_type: 'one_time_30d', status: 'paid', stripe_payment_intent_id: 'pi_b', current_period_end: iso(M + 30 * DAY), metadata: { granted_start: iso(M), granted_end: iso(M + 30 * DAY), stacked_on: null } }
    ]
  });
  await runWebhook(refundA);
  assert.equal(db.subscriptions[2].current_period_end, iso(M + 30 * DAY));
  assert.equal(new Date(db.profiles[0].pro_until).getTime(), M + 30 * DAY);
});

test('compra empilhada grava em qual passe ela começou', async () => {
  const t = Date.now();
  const { db } = fakeBackend({
    profiles: [{ id: 'u1', role: 'user', plan: 'pro', pro_until: iso(t + 10 * DAY), stripe_customer_id: 'cus_1' }],
    subscriptions: [stackedPasses(t)[0]]
  });
  await runWebhook({ id: 'evt_st', type: 'checkout.session.completed', data: { object: session({ id: 'cs_2', payment_intent: 'pi_new', payment_status: 'paid' }) } });
  const created = db.subscriptions.find(r => r.stripe_payment_intent_id === 'pi_new');
  assert.equal(created.metadata.stacked_on, 's_a');
  assert.equal(created.metadata.granted_start, iso(t + 10 * DAY));
});

test('reserva presa há mais de 5 minutos é liberada; reserva recente responde 409', async () => {
  const old = { id: 'ev_old', event_type: 'stripe_event_processed', created_at: iso(Date.now() - 10 * 60 * 1000), metadata: { event_id: 'evt_stuck', status: 'processing', reserved_at: iso(Date.now() - 10 * 60 * 1000) } };
  const { db } = fakeBackend({ profiles: [{ id: 'u1', role: 'user', pro_until: null, stripe_customer_id: 'cus_1' }], events: [old] });
  const payload = { id: 'evt_stuck', type: 'checkout.session.completed', data: { object: session({ payment_status: 'paid' }) } };
  assert.equal((await runWebhook(payload)).status, 200);
  assert.equal(db.profiles[0].plan, 'pro');
  assert.equal(processedEvents(db).length, 1);
  assert.equal(processedEvents(db)[0].metadata.status, 'done');

  const fresh = { id: 'ev_new', event_type: 'stripe_event_processed', created_at: iso(Date.now() - 60 * 1000), metadata: { event_id: 'evt_busy', status: 'processing', reserved_at: iso(Date.now() - 60 * 1000) } };
  fakeBackend({ profiles: [{ id: 'u1', role: 'user', pro_until: null, stripe_customer_id: 'cus_1' }], events: [fresh] });
  assert.equal((await runWebhook({ ...payload, id: 'evt_busy' })).status, 409);
});

test('falha ao liberar a reserva vira log estruturado', async () => {
  const logged = [];
  const original = console.error;
  console.error = (line) => logged.push(line);
  try {
    fakeBackend({
      profiles: [],
      fail: (req) => req.method === 'DELETE' && req.path.startsWith('/rest/v1/app_events')
    });
    const res = await runWebhook({ id: 'evt_rel', type: 'checkout.session.completed', data: { object: session({ payment_status: 'paid' }) } });
    assert.equal(res.status, 500);
  } finally {
    console.error = original;
  }
  const entries = logged.filter(l => typeof l === 'string' && l.startsWith('{')).map(l => JSON.parse(l));
  assert.ok(entries.some(e => e.level === 'error' && e.context === 'stripe-webhook' && e.step === 'release_reservation' && e.event_id === 'evt_rel'));
});
