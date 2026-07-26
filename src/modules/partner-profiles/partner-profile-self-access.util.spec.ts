import { canAccessPartnerProfileSelf } from './partner-profile-self-access.util';

describe('canAccessPartnerProfileSelf', () => {
  it('autorise PARTNER', () => {
    expect(canAccessPartnerProfileSelf('PARTNER')).toBe(true);
  });

  it('autorise candidats USER/VENDOR/DELIVERY', () => {
    expect(canAccessPartnerProfileSelf('USER')).toBe(true);
    expect(canAccessPartnerProfileSelf('VENDOR')).toBe(true);
    expect(canAccessPartnerProfileSelf('DELIVERY')).toBe(true);
  });

  it('refuse ADMIN et vide', () => {
    expect(canAccessPartnerProfileSelf('ADMIN')).toBe(false);
    expect(canAccessPartnerProfileSelf(null)).toBe(false);
    expect(canAccessPartnerProfileSelf('')).toBe(false);
  });
});
