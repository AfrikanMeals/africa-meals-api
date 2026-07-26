import { normalizePartnerReferralCode } from '@modules/partner-applications/partner-referral-code.util';

/**
 * Contrat lookup public — pure (pas de Nest) : format code avant query DB.
 */
describe('partner referral lookup contract', () => {
  it('accepte un code 6 alphanum', () => {
    expect(normalizePartnerReferralCode('qq4vjz')).toBe('QQ4VJZ');
    expect(normalizePartnerReferralCode('QQ4VJZ')).toBe('QQ4VJZ');
  });

  it('rejette format invalide', () => {
    expect(normalizePartnerReferralCode('ABC')).toBeNull();
    expect(normalizePartnerReferralCode('QQ4VJ!')).toBeNull();
    expect(normalizePartnerReferralCode('')).toBeNull();
  });
});
