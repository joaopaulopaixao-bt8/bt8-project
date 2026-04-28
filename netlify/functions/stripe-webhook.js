const crypto = require('crypto');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body)
});

const parseSignature = (header) => Object.fromEntries(
  String(header || '')
    .split(',')
    .map(part => part.split('='))
    .filter(parts => parts.length === 2)
);

const timingSafeEqual = (a, b) => {
  const left = Buffer.from(a || '', 'utf8');
  const right = Buffer.from(b || '', 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const verifyStripeSignature = (rawBody, signatureHeader, secret) => {
  const sig = parseSignature(signatureHeader);
  const timestamp = sig.t;
  const signature = sig.v1;
  if (!timestamp || !signature) throw new Error('Missing Stripe signature.');

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) throw new Error('Stripe signature timestamp is outside tolerance.');

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');

  if (!timingSafeEqual(expected, signature)) throw new Error('Invalid Stripe signature.');
};

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

const stripeGet = async (secretKey, path) => {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { authorization: `Bearer ${secretKey}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Stripe ${res.status}`);
  return data;
};

const findPeriodEnd = (subscription) => {
  const candidates = [
    subscription?.current_period_end,
    subscription?.items?.data?.[0]?.current_period_end,
    subscription?.items?.data?.[0]?.price?.recurring?.interval ? subscription.current_period_end : null
  ];
  const value = candidates.find(Boolean);
  return value ? new Date(value * 1000).toISOString() : null;
};

const addDays = (date, days) => {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
};

const upsertSubscription = async (supabaseUrl, serviceKey, payload) => {
  const matchColumn = payload.stripe_subscription_id
    ? `stripe_subscription_id=eq.${encodeURIComponent(payload.stripe_subscription_id)}`
    : payload.stripe_payment_intent_id
      ? `stripe_payment_intent_id=eq.${encodeURIComponent(payload.stripe_payment_intent_id)}`
      : null;

  if (matchColumn) {
    const existing = await supabaseFetch(supabaseUrl, serviceKey, `subscriptions?select=id&${matchColumn}&limit=1`);
    if (existing?.[0]?.id) {
      await supabaseFetch(supabaseUrl, serviceKey, `subscriptions?id=eq.${existing[0].id}`, {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() })
      });
      return;
    }
  }

  await supabaseFetch(supabaseUrl, serviceKey, 'subscriptions', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify(payload)
  });
};

const updateProfilePlan = async (supabaseUrl, serviceKey, userId, payload) => {
  await supabaseFetch(supabaseUrl, serviceKey, `profiles?id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() })
  });
};

const trackEvent = async (supabaseUrl, serviceKey, event) => {
  await supabaseFetch(supabaseUrl, serviceKey, 'app_events', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify(event)
  }).catch(() => {});
};

const subscriptionMetadata = (subscription) => ({
  cancel_at_period_end: !!subscription.cancel_at_period_end,
  billing_cycle_anchor: subscription.billing_cycle_anchor ? new Date(subscription.billing_cycle_anchor * 1000).toISOString() : null,
  cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null,
  canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
  trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
  previous_plan_type: subscription.metadata?.previous_plan_type || null,
  scheduled_from_30d_until: subscription.metadata?.scheduled_from_30d_until || null
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.BT8_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.BT8_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const stripeKey = process.env.BT8_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.BT8_STRIPE_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET;

  const missing = [
    !supabaseUrl ? 'BT8_SUPABASE_URL' : null,
    !serviceKey ? 'BT8_SUPABASE_SERVICE_ROLE_KEY' : null,
    !stripeKey ? 'BT8_STRIPE_SECRET_KEY' : null,
    !webhookSecret ? 'BT8_STRIPE_WEBHOOK_SECRET' : null
  ].filter(Boolean);
  if (missing.length) return json(500, { error: 'Webhook service is not configured.', missing });

  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  try {
    verifyStripeSignature(rawBody, event.headers['stripe-signature'] || event.headers['Stripe-Signature'], webhookSecret);
  } catch (e) {
    return json(400, { error: e.message });
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(rawBody);
  } catch (e) {
    return json(400, { error: 'Invalid JSON body.' });
  }

  try {
    const type = stripeEvent.type;
    const object = stripeEvent.data?.object || {};

    if (type === 'checkout.session.completed') {
      const userId = object.client_reference_id || object.metadata?.user_id;
      const planType = object.metadata?.plan_type || (object.mode === 'subscription' ? 'recurring' : 'one_time_30d');
      if (!userId) throw new Error('Missing user_id on checkout session.');

      let proUntil = null;
      let subscriptionDetails = null;
      if (planType === 'one_time_30d') {
        proUntil = addDays(new Date(), 30).toISOString();
      } else if (object.subscription) {
        subscriptionDetails = await stripeGet(stripeKey, `subscriptions/${object.subscription}?expand[]=items.data.price`);
        proUntil = findPeriodEnd(subscriptionDetails);
      }
      const nextStatus = subscriptionDetails?.status || object.payment_status || 'active';

      await updateProfilePlan(supabaseUrl, serviceKey, userId, {
        plan: 'pro',
        pro_until: proUntil,
        stripe_customer_id: object.customer,
        subscription_status: nextStatus
      });

      await upsertSubscription(supabaseUrl, serviceKey, {
        user_id: userId,
        stripe_customer_id: object.customer,
        stripe_subscription_id: object.subscription || null,
        stripe_payment_intent_id: object.payment_intent || null,
        plan_type: planType,
        status: nextStatus,
        price_id: subscriptionDetails?.items?.data?.[0]?.price?.id || object.metadata?.price_id || null,
        current_period_end: proUntil,
        metadata: {
          ...(subscriptionDetails ? subscriptionMetadata(subscriptionDetails) : {}),
          checkout_session_id: object.id,
          event_id: stripeEvent.id,
          plan_type: planType
        }
      });

      await trackEvent(supabaseUrl, serviceKey, {
        user_id: userId,
        event_type: 'payment_completed',
        metadata: { plan_type: planType, checkout_session_id: object.id }
      });
    }

    if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
      let subscription = object;
      const customers = await supabaseFetch(
        supabaseUrl,
        serviceKey,
        `profiles?select=id&stripe_customer_id=eq.${encodeURIComponent(subscription.customer)}&limit=1`
      );
      const userId = customers?.[0]?.id;
      if (userId) {
        const isDeleted = type === 'customer.subscription.deleted';
        if (!isDeleted && subscription.id) {
          subscription = await stripeGet(stripeKey, `subscriptions/${subscription.id}?expand[]=items.data.price`);
        }
        const proUntil = findPeriodEnd(subscription);
        const cancelAtPeriodEnd = !!subscription.cancel_at_period_end;
        const nextStatus = isDeleted
          ? 'canceled'
          : cancelAtPeriodEnd
            ? 'cancel_at_period_end'
            : subscription.status;
        await updateProfilePlan(supabaseUrl, serviceKey, userId, {
          plan: isDeleted ? 'free' : 'pro',
          pro_until: isDeleted ? null : proUntil,
          subscription_status: nextStatus
        });
        await upsertSubscription(supabaseUrl, serviceKey, {
          user_id: userId,
          stripe_customer_id: subscription.customer,
          stripe_subscription_id: subscription.id,
          plan_type: 'recurring',
          status: nextStatus,
          price_id: subscription.items?.data?.[0]?.price?.id || null,
          current_period_end: isDeleted ? null : proUntil,
          metadata: { ...subscriptionMetadata(subscription), event_id: stripeEvent.id }
        });
        await trackEvent(supabaseUrl, serviceKey, {
          user_id: userId,
          event_type: isDeleted ? 'subscription_cancelled' : 'subscription_updated',
          metadata: { status: nextStatus, subscription_id: subscription.id, cancel_at_period_end: cancelAtPeriodEnd }
        });
      }
    }

    if (type === 'invoice.payment_failed') {
      const invoice = object;
      const customers = await supabaseFetch(
        supabaseUrl,
        serviceKey,
        `profiles?select=id&stripe_customer_id=eq.${encodeURIComponent(invoice.customer)}&limit=1`
      );
      const userId = customers?.[0]?.id;
      if (userId) {
        await updateProfilePlan(supabaseUrl, serviceKey, userId, { subscription_status: 'past_due' });
        await trackEvent(supabaseUrl, serviceKey, {
          user_id: userId,
          event_type: 'invoice_payment_failed',
          metadata: { invoice_id: invoice.id }
        });
      }
    }

    return json(200, { received: true });
  } catch (e) {
    return json(500, { error: e.message || 'Webhook handling failed.' });
  }
};
