const crypto = require('crypto');
const {
  stripeRequest,
  isResourceMissing,
  isCheckoutPaid,
  planForSubscriptionStatus,
  laterIso,
  oneTimeGrant,
  unusedGrantMs,
  revokeOneTimeProUntil,
  subscriptionProUntil,
  invoiceSubscriptionId,
  invoiceSubscriptionMetadata,
  ENTITLED_ROW_STATUSES,
  logError
} = require('./lib/stripe');

// A reservation still 'processing' after this long belongs to a delivery that died
// (Netlify Functions time out well before it).
const RESERVATION_TTL_MS = 5 * 60 * 1000;

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
    const error = new Error(data?.message || data?.hint || text || `Supabase ${res.status}`);
    error.status = res.status;
    error.code = data?.code;
    throw error;
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
  const idOf = (value) => (typeof value === 'string' ? value : value?.id) || null;
  let livemode = null;
  const timeOf = (iso) => (iso ? new Date(iso).getTime() : 0);

  const trackEvent = (event) => db('app_events', {
    method: 'POST',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify(event)
  }).catch(() => {});

  // F0-04: app_events doubles as the processed-events log. The event is reserved BEFORE
  // processing (metadata.status = 'processing') and marked 'done' at the end; with the
  // unique index (see docs/STRIPE_PRODUCAO.md) a concurrent second delivery gets a conflict.
  // A reservation left 'processing' longer than RESERVATION_TTL_MS (timeout, crash) is
  // considered free again; every handler below is safe to re-run.
  const reservationState = async (eventId) => {
    const row = (await db(`app_events?select=id,created_at,metadata&event_type=eq.stripe_event_processed&metadata->>event_id=${eq(eventId)}&limit=1`))?.[0];
    if (!row) return { state: 'free' };
    // Rows written before the status field existed were only written on success.
    if (!row.metadata?.status || row.metadata.status === 'done') return { state: 'done' };
    const age = Date.now() - timeOf(row.metadata.reserved_at || row.created_at);
    return { state: age > RESERVATION_TTL_MS ? 'stale' : 'processing', id: row.id };
  };
  const reserveEvent = async (stripeEvent) => {
    const rows = await db('app_events?select=id', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({
        event_type: 'stripe_event_processed',
        metadata: { event_id: stripeEvent.id, type: stripeEvent.type, status: 'processing', reserved_at: new Date().toISOString() }
      })
    });
    return rows?.[0]?.id;
  };
  const deleteReservation = (reservationId, onlyIfProcessing) => db(
    `app_events?id=${eq(reservationId)}${onlyIfProcessing ? '&metadata->>status=eq.processing' : ''}`,
    { method: 'DELETE', headers: { prefer: 'return=minimal' } }
  );
  const releaseEvent = (reservationId, stripeEvent) => (reservationId
    ? deleteReservation(reservationId).catch((e) => {
      // The reservation expires after RESERVATION_TTL_MS anyway; log so it can be checked.
      logError('stripe-webhook', e, { step: 'release_reservation', event_id: stripeEvent.id, type: stripeEvent.type });
    })
    : Promise.resolve());
  const finishEvent = (reservationId, stripeEvent) => db(`app_events?id=${eq(reservationId)}`, {
    method: 'PATCH',
    headers: { prefer: 'return=minimal' },
    body: JSON.stringify({
      metadata: { event_id: stripeEvent.id, type: stripeEvent.type, status: 'done', done_at: new Date().toISOString() }
    })
  }).catch((e) => {
    // Work is done; a later retry after the TTL would re-run idempotent handlers only.
    logError('stripe-webhook', e, { step: 'finish_reservation', event_id: stripeEvent.id, type: stripeEvent.type });
  });

  const PROFILE_FIELDS = 'id,role,pro_until';
  const getProfileById = async (userId) => (
    userId ? (await db(`profiles?select=${PROFILE_FIELDS}&id=${eq(userId)}&limit=1`))?.[0] || null : null
  );
  const getProfileByCustomer = async (customerId) => (
    customerId ? (await db(`profiles?select=${PROFILE_FIELDS}&stripe_customer_id=${eq(customerId)}&limit=1`))?.[0] || null : null
  );

  // Profile by Stripe customer, then by metadata.user_id on the object, then by the
  // user_id create-checkout stores on the Stripe customer.
  const resolveProfile = async ({ customerId, userId }) => {
    const byCustomer = await getProfileByCustomer(customerId);
    if (byCustomer) return byCustomer;
    const byMetadata = await getProfileById(userId);
    if (byMetadata) return byMetadata;
    if (!customerId) return null;
    const customer = await stripe(`customers/${customerId}`).catch((e) => {
      if (isResourceMissing(e)) return null;
      throw e;
    });
    return getProfileById(customer?.metadata?.user_id);
  };

  // F0-06 review: a PATCH that matches no row must fail (500 + Stripe retry), not pass as 200.
  const updateProfilePlan = async (userId, payload) => {
    const rows = await db(`profiles?id=${eq(userId)}&select=id`, {
      method: 'PATCH',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({ ...payload, updated_at: new Date().toISOString() })
    });
    if (!rows?.length) throw new Error(`Profile ${userId} not found.`);
  };

  // Latest end among the user's other rows that still give Pro.
  const entitlementFloor = async (userId, excludeRowId) => {
    const statuses = ENTITLED_ROW_STATUSES.join(',');
    const rows = await db(`subscriptions?select=id,status,current_period_end&user_id=${eq(userId)}&status=in.(${statuses})&current_period_end=gt.${encodeURIComponent(new Date().toISOString())}`);
    return (rows || [])
      .filter(row => row.id !== excludeRowId)
      .reduce((best, row) => (!best || timeOf(row.current_period_end) > timeOf(best.end)
        ? { end: row.current_period_end, status: row.status }
        : best), null);
  };

  // Review item 1: an event about one subscription/pass never cuts Pro that another paid
  // row still guarantees. pro_until = max(this row's end, the other entitled rows' ends).
  const applyPlan = async (userId, candidateUntil, rowId, status, extra = {}) => {
    const floor = await entitlementFloor(userId, rowId);
    const until = laterIso(candidateUntil, floor?.end);
    const isPro = !!until && new Date(until).getTime() > Date.now();
    const floorWins = !!floor && timeOf(floor.end) > timeOf(candidateUntil);
    await updateProfilePlan(userId, {
      ...extra,
      plan: isPro ? 'pro' : 'free',
      pro_until: isPro ? until : null,
      subscription_status: floorWins ? floor.status : status
    });
  };

  // F0-07: the row create-checkout wrote as checkout_started is found by its session id.
  const findSubscriptionRow = async ({ subscriptionId, paymentIntentId, checkoutSessionId }) => {
    const filters = [
      subscriptionId && `stripe_subscription_id=${eq(subscriptionId)}`,
      paymentIntentId && `stripe_payment_intent_id=${eq(paymentIntentId)}`,
      checkoutSessionId && `metadata->>checkout_session_id=${eq(checkoutSessionId)}`
    ].filter(Boolean);
    for (const filter of filters) {
      const rows = await db(`subscriptions?select=id,status,metadata,current_period_end&${filter}&order=created_at.desc&limit=1`);
      if (rows?.[0]) return rows[0];
    }
    return null;
  };

  // Returns the row id. livemode is recorded so manage-subscription can tell a test-mode
  // leftover from a subscription that really disappeared (review item 5).
  const saveSubscription = async (payload, existing) => {
    const metadata = { ...(existing?.metadata || {}), ...(payload.metadata || {}), ...(livemode === null ? {} : { livemode }) };
    if (existing?.id) {
      await db(`subscriptions?id=${eq(existing.id)}`, {
        method: 'PATCH',
        headers: { prefer: 'return=minimal' },
        body: JSON.stringify({ ...payload, metadata, updated_at: new Date().toISOString() })
      });
      return existing.id;
    }
    const rows = await db('subscriptions?select=id', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify({ ...payload, metadata })
    });
    return rows?.[0]?.id || null;
  };

  // PATCH one row, merging metadata with what is stored now (not with a stale copy).
  const patchRow = async (rowId, fields, metadataPatch) => {
    const current = (await db(`subscriptions?select=metadata&id=${eq(rowId)}&limit=1`))?.[0];
    if (!current) throw new Error(`Subscription row ${rowId} not found.`);
    await db(`subscriptions?id=${eq(rowId)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ ...fields, metadata: { ...(current.metadata || {}), ...metadataPatch }, updated_at: new Date().toISOString() })
    });
  };

  // The 30-day pass whose end is exactly where the profile's Pro ends now (null if the
  // current end comes from a monthly plan or there is no Pro left).
  const passEndingAt = async (userId, proUntil) => {
    if (timeOf(proUntil) <= Date.now()) return null;
    const rows = await db(`subscriptions?select=id,plan_type,current_period_end&user_id=${eq(userId)}&status=in.(${ENTITLED_ROW_STATUSES.join(',')})&current_period_end=gt.${encodeURIComponent(new Date().toISOString())}`);
    const match = (rows || []).find(r => Math.abs(timeOf(r.current_period_end) - timeOf(proUntil)) < 1000);
    return match?.plan_type === 'one_time_30d' ? match.id : null;
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
    if (!profile) throw new Error(`Profile ${userId} not found.`);
    if (profile.role === 'admin') {
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
      // Order matters for retries after a failure in the middle: (1) store the interval,
      // (2) apply it to the profile, (3) only then write the final mark. A retry reuses the
      // stored interval, so it never stacks twice and never skips the profile update.
      let grant = existing?.metadata?.granted_end
        ? { start: existing.metadata.granted_start, end: existing.metadata.granted_end, stackedOn: existing.metadata.stacked_on || null }
        : null;
      let rowId = existing?.id || null;
      if (!grant) {
        grant = { ...oneTimeGrant(profile.pro_until), stackedOn: await passEndingAt(userId, profile.pro_until) };
        rowId = await saveSubscription({
          ...base,
          status: 'paid',
          price_id: session.metadata?.price_id || undefined,
          current_period_end: grant.end,
          metadata: {
            ...base.metadata,
            granted_start: grant.start,
            granted_end: grant.end,
            // Review item 5: which pass this one was stacked on, so a refund of that pass
            // only pulls back the passes that really started at its end.
            stacked_on: grant.stackedOn
          }
        }, existing);
      }
      await applyPlan(userId, grant.end, rowId, 'paid', { stripe_customer_id: session.customer });
      await patchRow(rowId, {}, { pro_granted_at: new Date().toISOString() });
    } else {
      if (!session.subscription) throw new Error('Missing subscription on recurring checkout session.');
      const subscription = await stripe(`subscriptions/${session.subscription}?expand[]=items.data.price`);
      const isPro = planForSubscriptionStatus(subscription.status) === 'pro';
      const proUntil = isPro ? subscriptionProUntil(subscription) : null;
      const rowId = await saveSubscription({
        ...base,
        status: subscription.status,
        price_id: subscription.items?.data?.[0]?.price?.id || null,
        current_period_end: proUntil,
        metadata: { ...subscriptionMetadata(subscription), ...base.metadata }
      }, existing);
      await applyPlan(userId, proUntil, rowId, subscription.status, { stripe_customer_id: session.customer });
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
    const profile = await resolveProfile({ customerId: object.customer, userId: object.metadata?.user_id });
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
    const isPro = !isDeleted && planForSubscriptionStatus(subscription.status) === 'pro';
    const proUntil = isPro ? subscriptionProUntil(subscription) : null;
    const cancelAtPeriodEnd = !!subscription.cancel_at_period_end;
    const nextStatus = isDeleted
      ? 'canceled'
      : isPro && cancelAtPeriodEnd ? 'cancel_at_period_end' : subscription.status;

    const rowId = await saveSubscription({
      user_id: userId,
      stripe_customer_id: subscription.customer,
      stripe_subscription_id: subscription.id,
      plan_type: 'recurring',
      status: nextStatus,
      price_id: subscription.items?.data?.[0]?.price?.id || null,
      current_period_end: proUntil,
      metadata: { ...subscriptionMetadata(subscription), event_id: stripeEvent.id }
    }, existing);
    // incomplete* = first payment never went through: this subscription never gave Pro.
    if (!['incomplete', 'incomplete_expired'].includes(subscription.status)) {
      await applyPlan(userId, proUntil, rowId, nextStatus);
    }
    await trackEvent({
      user_id: userId,
      event_type: isDeleted ? 'subscription_cancelled' : 'subscription_updated',
      metadata: { status: nextStatus, subscription_id: subscription.id, cancel_at_period_end: cancelAtPeriodEnd }
    });
    return {};
  };

  const invoicePaymentFailed = async (invoice) => {
    const profile = await resolveProfile({
      customerId: invoice.customer,
      userId: invoiceSubscriptionMetadata(invoice)?.user_id
    });
    if (!profile) return { ignored: 'unknown_customer' };
    await updateProfilePlan(profile.id, { subscription_status: 'past_due' });
    await trackEvent({
      user_id: profile.id,
      event_type: 'invoice_payment_failed',
      metadata: { invoice_id: invoice.id, subscription_id: invoiceSubscriptionId(invoice) }
    });
    return {};
  };

  // Passes stacked on the refunded one (metadata.stacked_on, transitively) started at its
  // end: pull them back by the removed time. Passes that started at the end of something
  // else (e.g. a monthly plan) keep their dates. Each shifted row records which refund
  // moved it, so a retry after a failure never shifts it twice.
  const shiftStackedPasses = async (userId, refundedRowId, removedMs) => {
    if (!removedMs || !refundedRowId) return;
    const rows = await db(`subscriptions?select=id,metadata,current_period_end&user_id=${eq(userId)}&plan_type=eq.one_time_30d&status=eq.paid`);
    const shift = (value) => (value ? new Date(timeOf(value) - removedMs).toISOString() : value);
    let frontier = [refundedRowId];
    const seen = new Set(frontier);
    while (frontier.length) {
      const children = (rows || []).filter(r => frontier.includes(r.metadata?.stacked_on) && !seen.has(r.id));
      for (const row of children) {
        seen.add(row.id);
        const movedBy = row.metadata?.shifted_by_refund_of || [];
        if (movedBy.includes(refundedRowId)) continue;
        await db(`subscriptions?id=${eq(row.id)}`, {
          method: 'PATCH',
          headers: { prefer: 'return=minimal' },
          body: JSON.stringify({
            current_period_end: shift(row.current_period_end),
            metadata: {
              ...row.metadata,
              granted_start: shift(row.metadata.granted_start),
              granted_end: shift(row.metadata.granted_end),
              shifted_by_refund_of: [...movedBy, refundedRowId]
            },
            updated_at: new Date().toISOString()
          })
        });
      }
      frontier = children.map(r => r.id);
    }
  };

  // F0-06: a full refund or a dispute takes the Pro back. In both branches the final
  // status ('refunded'/'disputed') is written LAST, after the profile changed, so a retry
  // after a failure in the middle redoes the missing steps instead of stopping early.
  const chargeReversed = async (type, object, stripeEvent) => {
    const reason = type === 'charge.refunded' ? 'refunded' : 'disputed';
    const charge = type === 'charge.dispute.created' ? await stripe(`charges/${idOf(object.charge)}`) : object;
    const profile = await resolveProfile({ customerId: idOf(charge.customer), userId: charge.metadata?.user_id });
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

    // charge.invoice only exists up to acacia; on a basil+ endpoint the refunded charge
    // comes without it, so ask the payment intent (read with our pinned acacia version).
    let invoiceId = idOf(charge.invoice);
    if (!invoiceId && !('invoice' in charge) && charge.payment_intent) {
      const intent = await stripe(`payment_intents/${idOf(charge.payment_intent)}`).catch((e) => {
        if (isResourceMissing(e)) return null;
        throw e;
      });
      invoiceId = idOf(intent?.invoice);
    }

    if (invoiceId) {
      const invoice = await stripe(`invoices/${invoiceId}`);
      const subscriptionId = invoiceSubscriptionId(invoice);
      const existing = subscriptionId ? await findSubscriptionRow({ subscriptionId }) : null;
      if (REVOKED_STATUSES.includes(existing?.status)) return { duplicate: 'already_revoked' };
      if (subscriptionId) {
        // Skip the DELETE when a previous attempt already canceled it.
        const current = await stripe(`subscriptions/${subscriptionId}`).catch((e) => {
          if (isResourceMissing(e)) return null;
          throw e;
        });
        if (current && current.status !== 'canceled') {
          try {
            await stripe(`subscriptions/${subscriptionId}`, { method: 'DELETE' });
          } catch (e) {
            if (!isResourceMissing(e)) throw e;
          }
        }
      }
      // Other paid rows (e.g. a 30-day pass) still count; this subscription's row does not.
      await applyPlan(profile.id, null, existing?.id || null, reason);
      if (subscriptionId) {
        await saveSubscription({
          user_id: profile.id,
          stripe_customer_id: idOf(charge.customer),
          stripe_subscription_id: subscriptionId,
          plan_type: 'recurring',
          status: reason,
          current_period_end: null,
          metadata
        }, existing);
      }
    } else {
      const paymentIntentId = idOf(charge.payment_intent);
      const existing = await findSubscriptionRow({ paymentIntentId });
      if (REVOKED_STATUSES.includes(existing?.status)) return { duplicate: 'already_revoked' };

      // Step 1: decide the effect once and store it on the row; retries reuse it.
      let pending = existing?.metadata?.revoke_pending || null;
      let rowId = existing?.id || null;
      if (!pending) {
        const grant = existing?.metadata?.granted_end
          ? { start: existing.metadata.granted_start, end: existing.metadata.granted_end }
          : null;
        pending = grant
          // Profile becomes the max of the remaining paid rows (after the shift below).
          ? { removed_ms: unusedGrantMs(grant), until: null, legacy: false }
          // Row written before intervals were stored: fall back to "minus 30 days".
          : { removed_ms: 0, until: revokeOneTimeProUntil(profile.pro_until, null), legacy: true };
        rowId = await saveSubscription({
          user_id: profile.id,
          stripe_customer_id: idOf(charge.customer),
          stripe_payment_intent_id: paymentIntentId,
          plan_type: 'one_time_30d',
          ...(existing ? {} : { status: 'revoking' }),
          metadata: { revoke_pending: pending }
        }, existing);
      }
      // Step 2: move the passes stacked on this one (idempotent per row).
      if (!pending.legacy) await shiftStackedPasses(profile.id, rowId, pending.removed_ms);
      // Step 3: profile, ignoring this row.
      await applyPlan(profile.id, pending.until, rowId, reason);
      // Step 4: final mark.
      await patchRow(rowId, { status: reason, current_period_end: null }, metadata);
    }

    await trackEvent({
      user_id: profile.id,
      event_type: reason === 'refunded' ? 'payment_refunded' : 'payment_disputed',
      metadata: { charge_id: charge.id }
    });
    return {};
  };

  const dispatch = (type, object, stripeEvent) => {
    if (type === 'checkout.session.completed' || type === 'checkout.session.async_payment_succeeded') return checkoutPaid(object, stripeEvent);
    if (type === 'checkout.session.async_payment_failed') return checkoutAsyncFailed(object, stripeEvent);
    if (type === 'checkout.session.expired') return checkoutExpired(object, stripeEvent);
    if (type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') return subscriptionChanged(type, object, stripeEvent);
    if (type === 'invoice.payment_failed') return invoicePaymentFailed(object);
    return chargeReversed(type, object, stripeEvent);
  };

  const handle = async (stripeEvent) => {
    const type = stripeEvent.type;
    if (!HANDLED_EVENTS.includes(type)) return { ignored: 'unhandled_type' };
    livemode = typeof stripeEvent.livemode === 'boolean' ? stripeEvent.livemode : null;
    const before = await reservationState(stripeEvent.id);
    if (before.state === 'done') return { duplicate: 'event_id' };
    // Another delivery is working on it: non-2xx so Stripe tries again later.
    if (before.state === 'processing') return { inProgress: true };
    if (before.state === 'stale') {
      logError('stripe-webhook', new Error('Stale reservation taken over.'), { step: 'stale_reservation', event_id: stripeEvent.id, type });
      await deleteReservation(before.id, true);
    }

    let reservationId;
    try {
      reservationId = await reserveEvent(stripeEvent);
    } catch (e) {
      if (e.status === 409 || e.code === '23505') {
        return (await reservationState(stripeEvent.id)).state === 'done' ? { duplicate: 'event_id' } : { inProgress: true };
      }
      throw e;
    }
    let result;
    try {
      result = await dispatch(type, stripeEvent.data?.object || {}, stripeEvent);
    } catch (e) {
      // Free the reservation so Stripe's retry can process the event again.
      await releaseEvent(reservationId, stripeEvent);
      throw e;
    }
    await finishEvent(reservationId, stripeEvent);
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
    if (result.inProgress) return json(409, { error: 'Event is being processed by another delivery.' });
    return json(200, { received: true, ...result });
  } catch (e) {
    logError('stripe-webhook', e, { event_id: stripeEvent.id, type: stripeEvent.type });
    return json(500, { error: e.message || 'Webhook handling failed.' });
  }
};
