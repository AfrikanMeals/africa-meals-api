import {
  buildPartnerApplicationApprovedEmailCopy,
  buildPartnerApplicationRejectedEmailCopy,
} from './partner-application-decision-email.util';

describe('partner-application-decision-email.util', () => {
  it('approve : sujet + code referral 6 chars mis en avant', () => {
    const copy = buildPartnerApplicationApprovedEmailCopy({
      appName: 'Wise Eat',
      safeDisplayName: 'Ada',
      safeReferralCode: 'AB34XY',
      supportEmail: 'help@example.com',
    });
    expect(copy.subject).toContain('acceptée');
    expect(copy.referralParagraphs?.join(' ')).toContain('AB34XY');
    expect(copy.greetingLine).toContain('Ada');
  });

  it('reject : inclut le motif', () => {
    const copy = buildPartnerApplicationRejectedEmailCopy({
      appName: 'Wise Eat',
      safeDisplayName: 'Bob',
      safeRejectionReason: 'Dossier incomplet',
      supportEmail: 'help@example.com',
    });
    expect(copy.subject).toContain('refusée');
    expect(copy.bodyParagraphs.join(' ')).toContain('Dossier incomplet');
  });
});
