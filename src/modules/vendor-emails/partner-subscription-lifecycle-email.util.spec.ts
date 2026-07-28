import {
  buildPartnerCustomPlanCreatedEmailCopy,
  buildPartnerSubscriptionChangedEmailCopy,
  buildPartnerSubscriptionExpiredEmailCopy,
  buildPartnerSubscriptionOfferEmailCopy,
  buildPartnerSubscriptionTrialReminderEmailCopy,
} from './partner-subscription-lifecycle-email.util';

describe('partner-subscription-lifecycle-email.util', () => {
  it('custom plan created : sujet + plan', () => {
    const c = buildPartnerCustomPlanCreatedEmailCopy({
      appName: 'Wise Eat',
      safeDisplayName: 'Ada',
      safePlanName: 'Pro Privé',
      supportEmail: 'help@example.com',
    });
    expect(c.subject).toMatch(/personnalisée/i);
    expect(c.bodyParagraphs.join(' ')).toContain('Pro Privé');
  });

  it('offer : sujet + note', () => {
    const c = buildPartnerSubscriptionOfferEmailCopy({
      appName: 'Wise Eat',
      safeDisplayName: 'Ada',
      safePlanName: 'Pro Partner',
      supportEmail: 'help@example.com',
      safeOfferNote: 'Bienvenue',
      periodLabel: 'Mensuel',
      startsLabel: '01/01/2026',
      endsLabel: '01/02/2026',
    });
    expect(c.subject).toMatch(/Offre/i);
    expect(c.bodyParagraphs.join(' ')).toContain('Pro Partner');
    expect(c.bodyParagraphs.join(' ')).toContain('Bienvenue');
  });

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
