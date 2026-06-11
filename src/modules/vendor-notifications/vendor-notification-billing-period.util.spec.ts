import {
  billingPeriodKey,
  normalizeBillingCyclePeriod,
  previousBillingPeriodKey,
  shouldClosePreviousBillingPeriod,
  VendorNotificationBillingCyclePeriodEnum,
} from './vendor-notification-billing-period.util';

describe('vendor-notification-billing-period.util', () => {
  it('builds monthly keys', () => {
    const date = new Date(Date.UTC(2026, 5, 10, 12, 0, 0));
    expect(
      billingPeriodKey(date, VendorNotificationBillingCyclePeriodEnum.MONTHLY),
    ).toBe('2026-06');
  });

  it('builds daily keys', () => {
    const date = new Date(Date.UTC(2026, 5, 10, 12, 0, 0));
    expect(
      billingPeriodKey(date, VendorNotificationBillingCyclePeriodEnum.DAILY),
    ).toBe('2026-06-10');
  });

  it('normalizes invalid period to monthly', () => {
    expect(normalizeBillingCyclePeriod('invalid')).toBe(
      VendorNotificationBillingCyclePeriodEnum.MONTHLY,
    );
  });

  it('closes daily periods every day', () => {
    expect(
      shouldClosePreviousBillingPeriod(
        new Date(Date.UTC(2026, 5, 10)),
        VendorNotificationBillingCyclePeriodEnum.DAILY,
      ),
    ).toBe(true);
  });

  it('closes weekly periods on monday only', () => {
    expect(
      shouldClosePreviousBillingPeriod(
        new Date(Date.UTC(2026, 5, 8)),
        VendorNotificationBillingCyclePeriodEnum.WEEKLY,
      ),
    ).toBe(true);
    expect(
      shouldClosePreviousBillingPeriod(
        new Date(Date.UTC(2026, 5, 10)),
        VendorNotificationBillingCyclePeriodEnum.WEEKLY,
      ),
    ).toBe(false);
  });

  it('returns previous monthly period', () => {
    expect(
      previousBillingPeriodKey(
        new Date(Date.UTC(2026, 5, 1)),
        VendorNotificationBillingCyclePeriodEnum.MONTHLY,
      ),
    ).toBe('2026-05');
  });
});
