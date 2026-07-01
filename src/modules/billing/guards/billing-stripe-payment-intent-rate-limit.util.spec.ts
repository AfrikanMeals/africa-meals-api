import {
  billingStripePaymentIntentRateLimitConfig,
  isBillingStripePaymentIntentRateLimitEnabled,
} from './billing-stripe-payment-intent-rate-limit.util';

describe('billing-stripe-payment-intent-rate-limit.util', () => {
  it('enabled by default', () => {
    expect(isBillingStripePaymentIntentRateLimitEnabled(undefined)).toBe(true);
    expect(isBillingStripePaymentIntentRateLimitEnabled('false')).toBe(false);
  });

  it('parses custom limits from env', () => {
    const cfg = billingStripePaymentIntentRateLimitConfig({
      STRIPE_GROUPED_PI_RATE_LIMIT_ENABLED: 'true',
      STRIPE_GROUPED_PI_RATE_LIMIT_WINDOW_MS: '60000',
      STRIPE_GROUPED_PI_RATE_LIMIT_MAX_PER_USER: '5',
      STRIPE_GROUPED_PI_RATE_LIMIT_MAX_PER_IP: '10',
    });
    expect(cfg).toEqual({
      enabled: true,
      windowMs: 60_000,
      maxPerUser: 5,
      maxPerIp: 10,
    });
  });
});
