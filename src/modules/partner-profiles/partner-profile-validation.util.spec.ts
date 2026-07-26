import {
  isOptionalHttpUrl,
  isPartnerProfileIdentityComplete,
  isPartnerProfileReadyToSubmit,
  normalizePartnerAccountType,
  resolvePartnerDisplayName,
} from './partner-profile-validation.util';

describe('partner-profile-validation.util', () => {
  it('normalizePartnerAccountType', () => {
    expect(normalizePartnerAccountType('individual')).toBe('INDIVIDUAL');
    expect(normalizePartnerAccountType('COMPANY')).toBe('COMPANY');
    expect(normalizePartnerAccountType('other')).toBeNull();
  });

  it('resolvePartnerDisplayName selon le type', () => {
    expect(
      resolvePartnerDisplayName({
        accountType: 'INDIVIDUAL',
        individualName: 'Ada Lovelace',
      }),
    ).toBe('Ada Lovelace');
    expect(
      resolvePartnerDisplayName({
        accountType: 'COMPANY',
        companyName: 'SenTech Inc',
      }),
    ).toBe('SenTech Inc');
    expect(
      resolvePartnerDisplayName({
        accountType: 'INDIVIDUAL',
        individualName: 'A',
      }),
    ).toBeNull();
  });

  it('isOptionalHttpUrl — vide OK, schéma http(s) requis sinon', () => {
    expect(isOptionalHttpUrl('')).toBe(true);
    expect(isOptionalHttpUrl('https://facebook.com/x')).toBe(true);
    expect(isOptionalHttpUrl('ftp://x')).toBe(false);
    expect(isOptionalHttpUrl('not-a-url')).toBe(false);
  });

  it('identité : type + nom + adresse ≥5 (GPS optionnel API)', () => {
    expect(
      isPartnerProfileIdentityComplete({
        accountType: 'INDIVIDUAL',
        individualName: 'Ada',
        address: '12 Rue X',
      }),
    ).toBe(true);
    expect(
      isPartnerProfileIdentityComplete({
        accountType: 'INDIVIDUAL',
        individualName: 'Ada',
        address: '12',
      }),
    ).toBe(false);
  });

  it('soumission : identité + policy + URLs valides', () => {
    const base = {
      accountType: 'COMPANY' as const,
      companyName: 'SenTech',
      address: 'Montreal QC',
      policyAccepted: true,
      facebookUrl: 'https://facebook.com/wise',
    };
    expect(isPartnerProfileReadyToSubmit(base)).toBe(true);
    expect(
      isPartnerProfileReadyToSubmit({ ...base, policyAccepted: false }),
    ).toBe(false);
    expect(
      isPartnerProfileReadyToSubmit({
        ...base,
        tiktokUrl: 'bad',
      }),
    ).toBe(false);
  });
});
