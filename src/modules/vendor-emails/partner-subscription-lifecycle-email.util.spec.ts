import {
  buildPartnerSubscriptionChangedEmailCopy,
  buildPartnerSubscriptionExpiredEmailCopy,
  buildPartnerSubscriptionTrialReminderEmailCopy,
} from './partner-subscription-lifecycle-email.util';

describe('partner-subscription-lifecycle-email.util', () => {
  it('changed : sujet + plan', () => {
    const c = buildPartnerSubscriptionChangedEmailCopy({
      appName: 'Wise Eat',
      safeDisplayName: 'Ada',
      safePlanName: 'Pro',
      supportEmail: 'help@example.com',
    });
    expect(c.subject).toMatch(/mis à jour/i);
    expect(c.bodyParagraphs.join(' ')).toContain('Pro');
  });

  it('expired : sujet expiration', () => {
    const c = buildPartnerSubscriptionExpiredEmailCopy({
      appName: 'Wise Eat',
      safeDisplayName: 'Ada',
      safePlanName: 'Pro',
      supportEmail: 'help@example.com',
    });
    expect(c.subject).toMatch(/expiré/i);
  });

  it('trial reminder : jours restants', () => {
    const c = buildPartnerSubscriptionTrialReminderEmailCopy({
      appName: 'Wise Eat',
      safeDisplayName: 'Ada',
      safePlanName: 'Essai',
      daysRemaining: 2,
      supportEmail: 'help@example.com',
    });
    expect(c.bodyParagraphs.join(' ')).toContain('2');
  });
});
