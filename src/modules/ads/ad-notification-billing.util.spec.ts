import {
  aggregateNotificationBillingMetrics,
  computeNotificationBillingAmountCad,
} from './ad-notification-billing.util';
describe('ad-notification-billing.util', () => {
  it('calcule le montant notification', () => {
    const metrics = aggregateNotificationBillingMetrics([
      {
        channel: 'email',
        deliveries: 100,
        interactions: 10,
        conversions: 2,
      },
    ]);
    const amount = computeNotificationBillingAmountCad(metrics, {
      currency: 'CAD',
      emailDeliveryCad: 0.01,
      emailInteractionCad: 0.05,
      emailConversionCad: 0.2,
      pushDeliveryCad: 0,
      pushInteractionCad: 0,
      pushConversionCad: 0,
      inAppDeliveryCad: 0,
      inAppInteractionCad: 0,
      inAppConversionCad: 0,
      smsDeliveryCad: 0,
      smsInteractionCad: 0,
      smsConversionCad: 0,
    });
    expect(amount).toBe(100 * 0.01 + 10 * 0.05 + 2 * 0.2);
  });
});
