import { buildPartnerReferralCodeChangedEmailCopy } from './partner-referral-code-changed-email.util';

describe('partner-referral-code-changed-email.util', () => {
  it('remplacement : sujet + ancien / nouveau', () => {
    const copy = buildPartnerReferralCodeChangedEmailCopy({
      appName: 'Wise Eat',
      safeDisplayName: 'Ada',
      safeReferralCode: 'CODE01',
      safePreviousReferralCode: 'AB23CD',
      supportEmail: 'support@wise-eat.com',
    });
    expect(copy.subject).toMatch(/parrainage/i);
    expect(copy.bodyParagraphs.join(' ')).toMatch(/modifié/i);
    expect(copy.referralParagraphs.join(' ')).toContain('AB23CD');
    expect(copy.referralParagraphs.join(' ')).toContain('CODE01');
  });

  it('première définition : pas d’ancien', () => {
    const copy = buildPartnerReferralCodeChangedEmailCopy({
      appName: 'Wise Eat',
      safeDisplayName: 'Ada',
      safeReferralCode: 'XY2Z3W',
      supportEmail: 'support@wise-eat.com',
    });
    expect(copy.bodyParagraphs.join(' ')).toMatch(/défini/i);
    expect(copy.referralParagraphs.join(' ')).not.toMatch(/Ancien/i);
  });
});
