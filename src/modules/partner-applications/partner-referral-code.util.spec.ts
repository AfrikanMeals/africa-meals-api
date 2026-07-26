import {
  generatePartnerReferralCode,
  isValidPartnerReferralCode,
  normalizePartnerReferralCode,
  PARTNER_REFERRAL_CODE_LENGTH,
} from './partner-referral-code.util';

describe('partner-referral-code.util', () => {
  it('génère un code de 6 caractères dans l’alphabet autorisé', () => {
    const code = generatePartnerReferralCode();
    expect(code).toHaveLength(PARTNER_REFERRAL_CODE_LENGTH);
    expect(isValidPartnerReferralCode(code)).toBe(true);
  });

  it('produit des codes distincts (échantillon)', () => {
    const set = new Set(
      Array.from({ length: 40 }, () => generatePartnerReferralCode()),
    );
    expect(set.size).toBeGreaterThan(30);
  });

  it('rejette formats invalides (longueur / caractères hors A–Z0–9)', () => {
    expect(isValidPartnerReferralCode('ABC')).toBe(false);
    expect(isValidPartnerReferralCode('ABCDEFG')).toBe(false);
    expect(isValidPartnerReferralCode('ABC-01')).toBe(false);
    expect(isValidPartnerReferralCode(null)).toBe(false);
  });

  // Ancien alphabet Crockford : I/O/L/0/1 désormais acceptés.
  it('accepte I, O, L, 0, 1', () => {
    expect(isValidPartnerReferralCode('ABC0OI')).toBe(true);
    expect(isValidPartnerReferralCode('IL10XY')).toBe(true);
  });

  it('normalise en majuscules', () => {
    const sample = generatePartnerReferralCode().toLowerCase();
    expect(normalizePartnerReferralCode(sample)).toBe(sample.toUpperCase());
  });
});

