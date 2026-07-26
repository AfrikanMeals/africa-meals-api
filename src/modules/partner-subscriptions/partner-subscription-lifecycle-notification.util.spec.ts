import {
  buildPartnerSubscriptionLifecycleNotificationCopy,
  PARTNER_SUBSCRIPTION_CHANGED_TYPE,
  PARTNER_SUBSCRIPTION_EXPIRED_TYPE,
  PARTNER_SUBSCRIPTION_TRIAL_REMINDER_TYPE,
} from './partner-subscription-lifecycle-notification.util';

describe('partner-subscription-lifecycle-notification.util', () => {
  it('CHANGED mentionne le plan', () => {
    const c = buildPartnerSubscriptionLifecycleNotificationCopy({
      kind: 'CHANGED',
      planName: 'Pro',
    });
    expect(c.type).toBe(PARTNER_SUBSCRIPTION_CHANGED_TYPE);
    expect(c.body).toContain('Pro');
  });

  it('EXPIRED distinct de CHANGED', () => {
    const c = buildPartnerSubscriptionLifecycleNotificationCopy({
      kind: 'EXPIRED',
      planName: 'Pro',
    });
    expect(c.type).toBe(PARTNER_SUBSCRIPTION_EXPIRED_TYPE);
    expect(c.title).toMatch(/expiré/i);
  });

  it('TRIAL_REMINDER inclut jours restants', () => {
    const c = buildPartnerSubscriptionLifecycleNotificationCopy({
      kind: 'TRIAL_REMINDER',
      planName: 'Essai',
      daysRemaining: 3,
    });
    expect(c.type).toBe(PARTNER_SUBSCRIPTION_TRIAL_REMINDER_TYPE);
    expect(c.body).toContain('3');
  });
});
