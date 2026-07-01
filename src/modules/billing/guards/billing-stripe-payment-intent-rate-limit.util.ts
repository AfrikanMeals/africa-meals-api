export type BillingStripePaymentIntentRateLimitConfig = {
  enabled: boolean;
  windowMs: number;
  maxPerUser: number;
  maxPerIp: number;
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function isBillingStripePaymentIntentRateLimitEnabled(
  raw?: string,
): boolean {
  const v = String(
    raw ?? process.env.STRIPE_GROUPED_PI_RATE_LIMIT_ENABLED ?? 'true',
  )
    .trim()
    .toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'off';
}

export function billingStripePaymentIntentRateLimitConfig(
  env: NodeJS.ProcessEnv = process.env,
): BillingStripePaymentIntentRateLimitConfig {
  return {
    enabled: isBillingStripePaymentIntentRateLimitEnabled(
      env.STRIPE_GROUPED_PI_RATE_LIMIT_ENABLED,
    ),
    windowMs: parsePositiveInt(env.STRIPE_GROUPED_PI_RATE_LIMIT_WINDOW_MS, 15 * 60_000),
    maxPerUser: parsePositiveInt(env.STRIPE_GROUPED_PI_RATE_LIMIT_MAX_PER_USER, 12),
    maxPerIp: parsePositiveInt(env.STRIPE_GROUPED_PI_RATE_LIMIT_MAX_PER_IP, 30),
  };
}

export function clientIpFromRequest(req: {
  headers?: Record<string, unknown>;
  ip?: string;
}): string {
  return (
    String(req.headers?.['x-forwarded-for'] ?? '')
      .split(',')[0]
      ?.trim() ||
    req.ip ||
    'unknown'
  );
}
