// Shared Stripe helpers for the Netlify Functions. Lives in a subfolder so Netlify
// does not deploy it as a function of its own.

// One API version for every API call the Functions make (F0-09). Changing it changes
// response shapes (e.g. current_period_end moved to items in 2025-03-31.basil), so bump
// it on purpose. Webhook events are NOT covered: they use the endpoint's version.
const STRIPE_API_VERSION = '2025-02-24.acacia';

const DAY_MS = 24 * 60 * 60 * 1000;
const ONE_TIME_DAYS = 30;

const stripeRequest = async (secretKey, path, options = {}) => {
  const params = options.body
    ? Object.fromEntries(Object.entries(options.body).filter(([, v]) => v !== undefined && v !== null && v !== ''))
    : null;
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: options.method || (params ? 'POST' : 'GET'),
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
      'Stripe-Version': STRIPE_API_VERSION
    },
    body: params ? new URLSearchParams(params) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data?.error?.message || `Stripe ${res.status}`);
    error.type = data?.error?.type;
    error.code = data?.error?.code;
    error.param = data?.error?.param;
    error.status = res.status;
    throw error;
  }
  return data;
};

// A test-mode customer/subscription id does not exist in live mode (F0-08).
const isResourceMissing = (error) => error?.code === 'resource_missing';
const isLiveKey = (secretKey) => /^(sk|rk)_live_/.test(String(secretKey || ''));

// F0-03: only these payment states mean the money is in.
const isCheckoutPaid = (session) => ['paid', 'no_payment_required'].includes(session?.payment_status);

// F0-05: Stripe keeps retrying a past_due invoice, so the user keeps Pro meanwhile.
const PRO_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'];
const planForSubscriptionStatus = (status) => (PRO_SUBSCRIPTION_STATUSES.includes(status) ? 'pro' : 'free');

const toTime = (value) => {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : null;
};

const laterIso = (...values) => {
  const times = values.map(toTime).filter(Boolean);
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
};

// F0-04: a 30-day pass stacks on top of whatever Pro time is left. The interval is kept
// on the subscription row so a refund can take back exactly what this pass added.
const oneTimeGrant = (currentProUntil, now = new Date()) => {
  const start = Math.max(toTime(currentProUntil) || 0, now.getTime());
  return {
    start: new Date(start).toISOString(),
    end: new Date(start + ONE_TIME_DAYS * DAY_MS).toISOString()
  };
};

// Days of this pass not used yet: max(0, end - max(start, now)). Rows written before the
// interval was stored count as a full 30 days.
const unusedGrantMs = (grant, now = new Date()) => {
  const start = toTime(grant?.start);
  const end = toTime(grant?.end);
  if (!start || !end) return ONE_TIME_DAYS * DAY_MS;
  return Math.max(0, end - Math.max(start, now.getTime()));
};

// F0-06: refunding one 30-day pass removes only what is left of that pass; null = no Pro left.
const revokeOneTimeProUntil = (currentProUntil, grant, now = new Date()) => {
  const current = toTime(currentProUntil);
  if (!current) return null;
  const next = current - unusedGrantMs(grant, now);
  return next > now.getTime() ? new Date(next).toISOString() : null;
};

// F0-09: a recurring subscription without a period end is a bug, not "Pro forever".
const subscriptionPeriodEnd = (subscription) => {
  const value = subscription?.current_period_end || subscription?.items?.data?.[0]?.current_period_end;
  if (!value) throw new Error(`Subscription ${subscription?.id || '?'} has no current_period_end.`);
  return new Date(value * 1000).toISOString();
};

// A renewal that failed leaves the subscription past_due with the new period already
// open; keep Pro only for a short grace after the period started, not the whole month.
const PAST_DUE_GRACE_DAYS = 3;
const subscriptionProUntil = (subscription) => {
  const end = subscriptionPeriodEnd(subscription);
  const start = subscription?.current_period_start || subscription?.items?.data?.[0]?.current_period_start;
  if (subscription?.status !== 'past_due' || !start) return end;
  const graceEnd = start * 1000 + PAST_DUE_GRACE_DAYS * DAY_MS;
  return new Date(Math.min(toTime(end), graceEnd)).toISOString();
};

// Webhook payloads follow the ENDPOINT's API version, not STRIPE_API_VERSION. The live
// endpoint is on 2026-03-25.dahlia (can't be changed), so read both shapes:
// acacia: invoice.subscription / invoice.subscription_details
// basil+: invoice.parent.subscription_details.{subscription,metadata}
const idOf = (value) => (typeof value === 'string' ? value : value?.id) || null;
const invoiceSubscriptionId = (invoice) => idOf(invoice?.subscription)
  || idOf(invoice?.parent?.subscription_details?.subscription);
const invoiceSubscriptionMetadata = (invoice) => invoice?.subscription_details?.metadata
  || invoice?.parent?.subscription_details?.metadata
  || null;

// Row statuses that still give Pro until their current_period_end.
const ENTITLED_ROW_STATUSES = ['active', 'trialing', 'past_due', 'cancel_at_period_end', 'paid'];

// Blocks a second monthly plan and a 30-day pass on top of a live monthly plan (F0-04).
const isRecurringActive = (row) => !!(
  row?.plan_type === 'recurring'
  && row.stripe_subscription_id
  && !row.metadata?.cancel_at_period_end
  && PRO_SUBSCRIPTION_STATUSES.concat('unpaid').includes(row.status)
);

// F0-10: success/cancel URLs may only point at our own sites.
const DEFAULT_ALLOWED_ORIGINS = [
  'https://bt8.com.br',
  'https://www.bt8.com.br',
  'https://mvp-pago--bt8torneio.netlify.app',
  'http://localhost:8888'
];

const allowedOrigins = (env = process.env) => [
  ...DEFAULT_ALLOWED_ORIGINS,
  // Netlify sets URL (main site) and DEPLOY_PRIME_URL (branch/preview deploy) itself.
  env.URL,
  env.DEPLOY_PRIME_URL,
  ...String(env.BT8_ALLOWED_ORIGINS || '').split(',')
].map(o => String(o || '').trim().replace(/\/$/, '')).filter(Boolean);

const resolveOrigin = (requested, allowed = allowedOrigins()) => {
  const origin = String(requested || '').trim().replace(/\/$/, '');
  return allowed.includes(origin) ? origin : null;
};

// Structured log, one JSON line per error. Same shape as netlify/functions/_log.js from the
// build branch (claude/f0-build-*); point this at that file once both are merged.
// Never pass personal data in `extra`.
const logError = (context, error, extra) => {
  console.error(JSON.stringify({
    level: 'error',
    context,
    message: error?.message || String(error),
    code: error?.code || error?.status || undefined,
    stack: error?.stack ? String(error.stack).split('\n').slice(0, 6).join('\n') : undefined,
    ...(extra || {}),
    time: new Date().toISOString()
  }));
};

module.exports = {
  logError,
  STRIPE_API_VERSION,
  stripeRequest,
  isResourceMissing,
  isLiveKey,
  isCheckoutPaid,
  planForSubscriptionStatus,
  laterIso,
  oneTimeGrant,
  unusedGrantMs,
  revokeOneTimeProUntil,
  subscriptionPeriodEnd,
  subscriptionProUntil,
  invoiceSubscriptionId,
  invoiceSubscriptionMetadata,
  ENTITLED_ROW_STATUSES,
  PAST_DUE_GRACE_DAYS,
  isRecurringActive,
  allowedOrigins,
  resolveOrigin
};
