const crypto = require('crypto');
const {
  stripeRequest,
  isResourceMissing,
  isCheckoutPaid,
  planForSubscriptionStatus,
  extendOneTimeProUntil,
  revokeOneTimeProUntil,
  subscriptionPeriodEnd
} = require('./lib/stripe');

// Keep docs/STRIPE_PRODUCAO.md in sync: the Stripe endpoint must send exactly these.
const HANDLED_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
  'charge.refunded',
  'charge.dispute.created'
];

const REVOKED_STATUSES = ['refunded', 'disputed'];

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

const subscriptionMetadata = (subscription) => ({
  cancel_at_period_end: !!subscription.cancel_at_period_end,
  billing_cycle_anchor: subscription.billing_cycle_anchor ? new Date(subscription.billing_cycle_anchor * 1000).toISOString() : null,
  cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null,
  canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
  trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
  previous_plan_type: subscription.metadata?.previous_plan_type || null,
  scheduled_from_30d_until: subscription.metadata?.scheduled_from_30d_until || null
});

const createHandlers = (ctx) => {
  const db = (path, options) => supabaseFetch(ctx.supabaseUrl, ctx.serviceKey, path, options);
  const stripe = (path, options) => stripeRequest(ctx.stripeKey, path, options);
  const eq = (value) => `eq.${encodeURIComponent(value)}`;

  const trackEvent = (event) => db('app_events', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify(event)
  }).catch(() => {});

  // F0-04: idempotency without a new table, using app_events as the processed-events log.
  const alreadyProcessed = async (eventId) => {
    const rows = await db(`app_events?select=id&event_type=eq.stripe_event_processed&metadata->>event_id=${eq(eventId)}&limit=1`);
    return !!rows?.length;
  };
  const markProcessed = (stripeEvent) => trackEvent({
    event_type: 'stripe_event_processed',
    metadata: { event_id: stripeEvent.id, type: stripeEvent.type }
  });

  const getProfileById = async (userId) => (
    await db(`profiles?select=id,role,pro_until&id=${eq(userId)}&limit=1`)
  )?.[0] || null;

  const getProfileByCustomer = async (customerId) => (
    customerId ? (await db(`profiles?select=id,role,pro_until&stripe_customer_id=${eq(customerId)}&limit=1`))?.[0] || null : null
  );

  const updateProfilePlan = (userId, payload) => db(`profiles?id=${eq(userId)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() })
  });

  // F0-07: the row create-checkout wrote as checkout_started is found by its session id.
  const findSubscriptionRow = async ({ subscriptionId, paymentIntentId, checkoutSessionId }) => {
    const filters = [
      subscriptionId && `stripe_subscription_id=${eq(subscriptionId)}`,
      paymentIntentId && `stripe_payment_intent_id=${eq(paymentIntentId)}`,
      checkoutSessionId && `metadata->>checkout_session_id=${eq(checkoutSessionId)}`
    ].filter(Boolean);
    for (const filter of filters) {
      const rows = await db(`subscriptions?select=id,status,metadata&${filter}&order=created_at.desc&limit=1`);
      if (rows?.[0]) return rows[0];
    }
    return null;
  };

  const saveSubscription = async (payload, existing) => {
    if (existing?.id) {
      await db(`subscriptions?id=eq.${existing.id}`, {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({
          ...payload,
          metadata: { ...(existing.metadata || {}), ...(payload.metadata || {}) },
          updated_at: new Date().toISOString()
        })
      });
      return;
    }
    await db('subscriptions', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify(payload)
    });
  };

  const sessionMatch = (session) => ({
    subscriptionId: session.subscription,
    paymentIntentId: session.payment_intent,
    checkoutSessionId: session.id
  });

  const sessionPlanType = (session) => session.metadata?.plan_type || (session.mode === 'subscription' ? 'recurring' : 'one_time_30d');

  const sessionRowBase = (session, userId, stripeEvent) => ({
    user_id: userId,
    stripe_customer_id: session.customer,
    stripe_subscription_id: session.subscription || null,
    stripe_payment_intent_id: session.payment_intent || null,
    plan_type: sessionPlanType(session),
    metadata: { checkout_session_id: session.id, event_id: stripeEvent.id, plan_type: sessionPlanType(session) }
  });

  // checkout.session.completed and checkout.session.async_payment_succeeded.
  const checkoutPaid = async (session, stripeEvent) => {
    const userId = session.client_reference_id || session.metadata?.user_id;
    if (!userId) throw new Error('Missing user_id on checkout session.');
    const planType = sessionPlanType(session);
    const profile = await getProfileById(userId);
    if (profile?.role === 'admin') {
      await trackEvent({
        user_id: userId,
        event_type: 'admin_checkout_ignored',
        metadata: { checkout_session_id: session.id, plan_type: planType }
      });
      return { ignored: 'admin' };
    }

    const existing = await findSubscriptionRow(sessionMatch(session));
    const base = sessionRowBase(session, userId, stripeEvent);

    // F0-03: boleto/Pix-like methods complete the session before the money arrives.
    if (!isCheckoutPaid(session)) {
      await saveSubscription({ ...base, status: 'payment_pending' }, existing);
      await trackEvent({
        user_id: userId,
        event_type: 'checkout_payment_pending',
        metadata: { checkout_session_id: session.id, payment_status: session.payment_status || null }
      });
      return { pending: true };
    }

    if (planType === 'one_time_30d') {
      // A second "paid" event for the same session must not stack another 30 days.
      if (existing?.metadata?.pro_granted_at) return { duplicate: 'already_granted' };
      const proUntil = extendOneTimeProUntil(profile?.pro_until);
      await updateProfilePlan(userId, {
        plan: 'pro',
        pro_until: proUntil,
        stripe_customer_id: session.customer,
        subscription_status: 'paid'
      });
      await saveSubscription({
        ...base,
        status: 'paid',
        price_id: session.metadata?.price_id || undefined,
        current_period_end: proUntil,
        metadata: { ...base.metadata, pro_granted_at: new Date().toISOString() }
      }, existing);
    } else {
      if (!session.subscription) throw new Error('Missing subscription on recurring checkout session.');
      const subscription = await stripe(`subscriptions/${session.subscription}?expand[]=items.data.price`);
      const proUntil = subscriptionPeriodEnd(subscription);
      const plan = planForSubscriptionStatus(subscription.status);
      await updateProfilePlan(userId, {
        plan,
        pro_until: plan === 'pro' ? proUntil : null,
        stripe_customer_id: session.customer,
        subscription_status: subscription.status
      });
      await saveSubscription({
        ...base,
        status: subscription.status,
        price_id: subscription.items?.data?.[0]?.price?.id || null,
        current_period_end: proUntil,
        metadata: { ...subscriptionMetadata(subscription), ...base.metadata }
      }, existing);
    }

    // If a subscription event created its own row first, the checkout_started row is left over.
    await db(`subscriptions?metadata->>checkout_session_id=${eq(session.id)}&status=eq.checkout_started`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'superseded', updated_at: new Date().toISOString() })
    });

    await trackEvent({
      user_id: userId,
      event_type: 'payment_completed',
      metadata: { plan_type: planType, checkout_session_id: session.id }
    });
    return {};
  };

  const checkoutAsyncFailed = async (session, stripeEvent) => {
    const userId = session.client_reference_id || session.metadata?.user_id;
    if (!userId) throw new Error('Missing user_id on checkout session.');
    const existing = await findSubscriptionRow(sessionMatch(session));
    await saveSubscription({ ...sessionRowBase(session, userId, stripeEvent), status: 'payment_failed' }, existing);
    await trackEvent({
      user_id: userId,
      event_type: 'checkout_payment_failed',
      metadata: { checkout_session_id: session.id }
    });
    return {};
  };

  const checkoutExpired = async (session, stripeEvent) => {
    const existing = await findSubscriptionRow({ checkoutSessionId: session.id });
    if (!existing || existing.status !== 'checkout_started') return { ignored: 'no_pending_row' };
    await saveSubscription({ status: 'expired', metadata: { expired_event_id: stripeEvent.id } }, existing);
    return {};
  };

  // F0-05: the plan follows the subscription status.
  const subscriptionChanged = async (type, object, stripeEvent) => {
    const profile = await getProfileByCustomer(object.customer);
    if (!profile) return { ignored: 'unknown_customer' };
    const userId = profile.id;
    const existing = await findSubscriptionRow({ subscriptionId: object.id });

    if (profile.role === 'admin') {
      await saveSubscription({
        user_id: userId,
        stripe_customer_id: object.customer,
        stripe_subscription_id: object.id,
        plan_type: 'recurring',
        status: 'admin_blocked',
        current_period_end: null,
        metadata: { admin_blocked: true, event_id: stripeEvent.id }
      }, existing);
      await updateProfilePlan(userId, { plan: 'free', pro_until: null, subscription_status: 'admin_no_plan' });
      await trackEvent({
        user_id: userId,
        event_type: 'admin_subscription_ignored',
        metadata: { subscription_id: object.id, stripe_event: type }
      });
      return { ignored: 'admin' };
    }

    // A refund/dispute already revoked this subscription; a late update must not give Pro back.
    if (REVOKED_STATUSES.includes(existing?.status)) return { ignored: 'revoked' };

    const isDeleted = type === 'customer.subscription.deleted';
    const subscription = isDeleted ? object : await stripe(`subscriptions/${object.id}?expand[]=items.data.price`);
    const plan = isDeleted ? 'free' : planForSubscriptionStatus(subscription.status);
    const proUntil = plan === 'pro' ? subscriptionPeriodEnd(subscription) : null;
    const cancelAtPeriodEnd = !!subscription.cancel_at_period_end;
    const nextStatus = isDeleted
      ? 'canceled'
      : plan === 'pro' && cancelAtPeriodEnd ? 'cancel_at_period_end' : subscription.status;

    // incomplete* = first payment never went through: this subscription never gave Pro,
    // so leave the profile alone (the user may still have a running 30-day pass).
    if (!['incomplete', 'incomplete_expired'].includes(subscription.status)) {
      await updateProfilePlan(userId, { plan, pro_until: proUntil, subscription_status: nextStatus });
    }
    await saveSubscription({
      user_id: userId,
      stripe_customer_id: subscription.customer,
      stripe_subscription_id: subscription.id,
      plan_type: 'recurring',
      status: nextStatus,
      price_id: subscription.items?.data?.[0]?.price?.id || null,
      current_period_end: proUntil,
      metadata: { ...subscriptionMetadata(subscription), event_id: stripeEvent.id }
    }, existing);
    await trackEvent({
      user_id: userId,
      event_type: isDeleted ? 'subscription_cancelled' : 'subscription_updated',
      metadata: { status: nextStatus, subscription_id: subscription.id, cancel_at_period_end: cancelAtPeriodEnd }
    });
    return {};
  };

  const invoicePaymentFailed = async (invoice) => {
    const profile = await getProfileByCustomer(invoice.customer);
    if (!profile) return { ignored: 'unknown_customer' };
    await updateProfilePlan(profile.id, { subscription_status: 'past_due' });
    await trackEvent({
      user_id: profile.id,
      event_type: 'invoice_payment_failed',
      metadata: { invoice_id: invoice.id }
    });
    return {};
  };

  // F0-06: a full refund or a dispute takes the Pro back.
  const chargeReversed = async (type, object, stripeEvent) => {
    const reason = type === 'charge.refunded' ? 'refunded' : 'disputed';
    const charge = type === 'charge.dispute.created'
      ? await stripe(`charges/${typeof object.charge === 'string' ? object.charge : object.charge?.id}`)
      : object;
    const profile = await getProfileByCustomer(charge.customer);
    if (!profile) return { ignored: 'unknown_customer' };
    if (profile.role === 'admin') return { ignored: 'admin' };

    if (type === 'charge.refunded' && !charge.refunded) {
      await trackEvent({
        user_id: profile.id,
        event_type: 'charge_partially_refunded',
        metadata: { charge_id: charge.id, amount_refunded: charge.amount_refunded }
      });
      return { ignored: 'partial_refund' };
    }

    const metadata = { revoked_reason: reason, revoked_charge_id: charge.id, revoked_event_id: stripeEvent.id };

    if (charge.invoice) {
      const invoiceId = typeof charge.invoice === 'string' ? charge.invoice : charge.invoice.id;
      const invoice = await stripe(`invoices/${invoiceId}`);
      const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
      const existing = subscriptionId ? await findSubscriptionRow({ subscriptionId }) : null;
      if (REVOKED_STATUSES.includes(existing?.status)) return { duplicate: 'already_revoked' };
      if (subscriptionId) {
        try {
          await stripe(`subscriptions/${subscriptionId}`, { method: 'DELETE' });
        } catch (e) {
          if (!isResourceMissing(e)) throw e;
        }
      }
      await updateProfilePlan(profile.id, { plan: 'free', pro_until: null, subscription_status: reason });
      if (subscriptionId) {
        await saveSubscription({
          user_id: profile.id,
          stripe_customer_id: charge.customer,
          stripe_subscription_id: subscriptionId,
          plan_type: 'recurring',
          status: reason,
          current_period_end: null,
          metadata
        }, existing);
      }
    } else {
      const existing = await findSubscriptionRow({ paymentIntentId: charge.payment_intent });
      if (REVOKED_STATUSES.includes(existing?.status)) return { duplicate: 'already_revoked' };
      const proUntil = revokeOneTimeProUntil(profile.pro_until);
      await updateProfilePlan(profile.id, {
        plan: proUntil ? 'pro' : 'free',
        pro_until: proUntil,
        subscription_status: reason
      });
      await saveSubscription({
        user_id: profile.id,
        stripe_customer_id: charge.customer,
        stripe_payment_intent_id: charge.payment_intent || null,
        plan_type: 'one_time_30d',
        status: reason,
        metadata
      }, existing);
    }

    await trackEvent({
      user_id: profile.id,
      event_type: reason === 'refunded' ? 'payment_refunded' : 'payment_disputed',
      metadata: { charge_id: charge.id }
    });
    return {};
  };

  const handle = async (stripeEvent) => {
    const type = stripeEvent.type;
    const object = stripeEvent.data?.object || {};
    if (!HANDLED_EVENTS.includes(type)) return { ignored: 'unhandled_type' };
    if (await alreadyProcessed(stripeEvent.id)) return { duplicate: 'event_id' };

    let result;
    if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') {
      result = await checkoutPaid(object, stripeEvent);
    } else if (type === 'checkout.session.async_payment_failed') {
      result = await checkoutAsyncFailed(object, stripeEvent);
    } else if (type === 'checkout.session.expired') {
      result = await checkoutExpired(object, stripeEvent);
    } else if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
      result = await subscriptionChanged(type, object, stripeEvent);
    } else if (type === 'invoice.payment_failed') {
      result = await invoicePaymentFailed(object);
    } else {
      result = await chargeReversed(type, object, stripeEvent);
    }
    // Only after success: a failure returns 500 and Stripe retries the same event.
    await markProcessed(stripeEvent);
    return result;
  };

  return { handle };
};

exports.HANDLED_EVENTS = HANDLED_EVENTS;

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
    const result = await createHandlers({ supabaseUrl, serviceKey, stripeKey }).handle(stripeEvent);
    return json(200, { received: true, ...result });
  } catch (e) {
    console.error('stripe-webhook failed', { type: stripeEvent.type, id: stripeEvent.id, message: e.message });
    return json(500, { error: e.message || 'Webhook handling failed.' });
  }
};
