// Shared Stripe helpers for the Netlify Functions. Lives in a subfolder so Netlify
// does not deploy it as a function of its own.

// One API version for every Function (F0-09). Changing it changes payload shapes
// (e.g. current_period_end moved to items in 2025-03-31.basil), so bump it on purpose.
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

// F0-03: only these payment states mean the money is in.
const isCheckoutPaid = (session) => ['paid', 'no_payment_required'].includes(session?.payment_status);

// F0-05: Stripe keeps retrying a past_due invoice, so the user keeps Pro meanwhile.
const PRO_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'];
const planForSubscriptionStatus = (status) => (PRO_SUBSCRIPTION_STATUSES.includes(status) ? 'pro' : 'free');

const toTime = (value) => {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : null;
};

// F0-04: a 30-day pass stacks on top of whatever Pro time is left.
const extendOneTimeProUntil = (currentProUntil, now = new Date()) => {
  const base = Math.max(toTime(currentProUntil) || 0, now.getTime());
  return new Date(base + ONE_TIME_DAYS * DAY_MS).toISOString();
};

// F0-06: refunding one 30-day pass takes back those 30 days only; null means no Pro left.
const revokeOneTimeProUntil = (currentProUntil, now = new Date()) => {
  const current = toTime(currentProUntil);
  if (!current) return null;
  const next = current - ONE_TIME_DAYS * DAY_MS;
  return next > now.getTime() ? new Date(next).toISOString() : null;
};

// F0-09: a recurring subscription without a period end is a bug, not "Pro forever".
const subscriptionPeriodEnd = (subscription) => {
  const value = subscription?.current_period_end || subscription?.items?.data?.[0]?.current_period_end;
  if (!value) throw new Error(`Subscription ${subscription?.id || '?'} has no current_period_end.`);
  return new Date(value * 1000).toISOString();
};

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

module.exports = {
  STRIPE_API_VERSION,
  stripeRequest,
  isResourceMissing,
  isCheckoutPaid,
  planForSubscriptionStatus,
  extendOneTimeProUntil,
  revokeOneTimeProUntil,
  subscriptionPeriodEnd,
  isRecurringActive,
  allowedOrigins,
  resolveOrigin
};
