import {
  buildPartnerProfileApprovedEmailCopy,
  buildPartnerProfileRejectedEmailCopy,
} from './partner-profile-decision-email.util';

describe('partner-profile-decision-email.util', () => {
  it('approve : sujet fiche + code referral + pas de jargon candidature', () => {
    const copy = buildPartnerProfileApprovedEmailCopy({
      appName: 'Wise Eat',
      safeDisplayName: 'Kode102 Inc.',
      supportEmail: 'help@example.com',
      safeReferralCode: 'AB34XY',
    });
    expect(copy.subject).toMatch(/fiche partenaire approuvée/i);
    expect(copy.bodyParagraphs.join(' ')).toMatch(/fiche partenaire/i);
    expect(copy.bodyParagraphs.join(' ')).not.toMatch(/candidature/i);
    expect(copy.greetingLine).toContain('Kode102 Inc.');
    expect(copy.referralParagraphs?.join(' ')).toContain('AB34XY');
  });

  it('reject : inclut le motif et invite à re-soumettre', () => {
    const copy = buildPartnerProfileRejectedEmailCopy({
      appName: 'Wise Eat',
      safeDisplayName: 'Ada',
      safeRejectionReason: 'Adresse incomplète',
      supportEmail: 'help@example.com',
    });
    expect(copy.subject).toMatch(/fiche partenaire refusée/i);
    expect(copy.bodyParagraphs.join(' ')).toContain('Adresse incomplète');
    expect(copy.bodyParagraphs.join(' ')).toMatch(/soumettre/i);
    expect(copy.bodyParagraphs.join(' ')).not.toMatch(/candidature/i);
  });
});
