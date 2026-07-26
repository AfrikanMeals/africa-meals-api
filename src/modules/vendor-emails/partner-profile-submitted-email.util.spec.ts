import { buildPartnerProfileSubmittedEmailCopy } from './partner-profile-submitted-email.util';

describe('partner-profile-submitted-email.util', () => {
  it('construit sujet et paragraphes de confirmation', () => {
    const copy = buildPartnerProfileSubmittedEmailCopy({
      appName: 'Wise Eat',
      safeDisplayName: 'Ada Lovelace',
      supportEmail: 'help@example.com',
    });
    expect(copy.subject).toBe('Wise Eat — Fiche partenaire reçue');
    expect(copy.greetingLine).toContain('Ada Lovelace');
    expect(copy.introParagraphs.join(' ')).toMatch(/fiche partenaire/i);
    expect(copy.helpParagraphs.join(' ')).toContain('help@example.com');
  });

  it('fallback nom / app si vides', () => {
    const copy = buildPartnerProfileSubmittedEmailCopy({
      appName: '  ',
      safeDisplayName: '',
      supportEmail: '',
    });
    expect(copy.subject).toContain('Wise Eat');
    expect(copy.greetingLine).toContain('Partenaire');
    expect(copy.helpParagraphs.join(' ')).toContain('support@wise-eat.com');
  });
});
