import {
  isStripePayoutNoBalanceError,
  parseStripeMinDelayDaysFromError,
  resolveStripePayoutDelayDays,
} from './partner-badge-payout-schedule.util';

describe('partner-badge-payout-schedule.util', () => {
  it('parseStripeMinDelayDaysFromError extracts Stripe minimum', () => {
    expect(
      parseStripeMinDelayDaysFromError(
        'Invalid delay_days: must be at least 7 for this account',
      ),
    ).toBe(7);
    expect(
      parseStripeMinDelayDaysFromError(
        'delay_days must be greater than or equal to 4',
      ),
    ).toBe(4);
    expect(parseStripeMinDelayDaysFromError('unrelated')).toBeNull();
  });

  it('resolveStripePayoutDelayDays clamps to Stripe minimum', () => {
    expect(resolveStripePayoutDelayDays(3, 7)).toBe(7);
    expect(resolveStripePayoutDelayDays(7, 7)).toBe(7);
    expect(resolveStripePayoutDelayDays(10, 7)).toBe(10);
    expect(resolveStripePayoutDelayDays(3, null)).toBe(3);
    expect(resolveStripePayoutDelayDays(0, 7)).toBe(0);
  });

  it('isStripePayoutNoBalanceError detects pending balance failures', () => {
    expect(
      isStripePayoutNoBalanceError(
        Object.assign(new Error('Bad Request Exception'), {
          getResponse: () => ({
            statusCode: 400,
            message: 'stripe_payout_no_balance',
          }),
        }),
      ),
    ).toBe(true);
    expect(
      isStripePayoutNoBalanceError(new Error('Insufficient funds in Stripe')),
    ).toBe(true);
    expect(isStripePayoutNoBalanceError(new Error('network'))).toBe(false);
  });
});
