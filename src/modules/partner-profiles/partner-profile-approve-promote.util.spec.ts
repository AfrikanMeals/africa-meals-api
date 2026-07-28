import {
  resolvePreviousUserTypeForPartnerProfileApprove,
  shouldPromoteUserTypeOnPartnerProfileApprove,
} from './partner-profile-approve-promote.util';

describe('partner-profile-approve-promote.util', () => {
  describe('shouldPromoteUserTypeOnPartnerProfileApprove', () => {
    it('promouvoit les candidats USER / VENDOR / DELIVERY', () => {
      expect(shouldPromoteUserTypeOnPartnerProfileApprove('USER')).toBe(true);
      expect(shouldPromoteUserTypeOnPartnerProfileApprove('VENDOR')).toBe(true);
      expect(shouldPromoteUserTypeOnPartnerProfileApprove('DELIVERY')).toBe(
        true,
      );
    });

    it('ne promouvoit pas PARTNER / ADMIN / vide', () => {
      expect(shouldPromoteUserTypeOnPartnerProfileApprove('PARTNER')).toBe(
        false,
      );
      expect(shouldPromoteUserTypeOnPartnerProfileApprove('ADMIN')).toBe(false);
      expect(shouldPromoteUserTypeOnPartnerProfileApprove(null)).toBe(false);
      expect(shouldPromoteUserTypeOnPartnerProfileApprove('')).toBe(false);
    });
  });

  describe('resolvePreviousUserTypeForPartnerProfileApprove', () => {
    it('conserve VENDOR et DELIVERY pour restore suspend', () => {
      expect(resolvePreviousUserTypeForPartnerProfileApprove('VENDOR')).toBe(
        'VENDOR',
      );
      expect(resolvePreviousUserTypeForPartnerProfileApprove('DELIVERY')).toBe(
        'DELIVERY',
      );
    });

    it('repli USER pour client / inconnu', () => {
      expect(resolvePreviousUserTypeForPartnerProfileApprove('USER')).toBe(
        'USER',
      );
      expect(resolvePreviousUserTypeForPartnerProfileApprove(null)).toBe(
        'USER',
      );
    });
  });
});
