import {
  evaluatePartnerReferralAttach,
  isPartnerReferralAttachableUserType,
  partnerReferralAxisForUserType,
} from './partner-referral-admin-attach.util';

describe('partner-referral-admin-attach.util', () => {
  describe('isPartnerReferralAttachableUserType', () => {
    it('accepte USER / VENDOR / DELIVERY', () => {
      expect(isPartnerReferralAttachableUserType('USER')).toBe(true);
      expect(isPartnerReferralAttachableUserType('vendor')).toBe(true);
      expect(isPartnerReferralAttachableUserType('DELIVERY')).toBe(true);
    });

    it('refuse PARTNER / ADMIN / vide', () => {
      expect(isPartnerReferralAttachableUserType('PARTNER')).toBe(false);
      expect(isPartnerReferralAttachableUserType('ADMIN')).toBe(false);
      expect(isPartnerReferralAttachableUserType(null)).toBe(false);
    });
  });

  describe('partnerReferralAxisForUserType', () => {
    it('mappe les axes Référents', () => {
      expect(partnerReferralAxisForUserType('USER')).toBe('customer');
      expect(partnerReferralAxisForUserType('VENDOR')).toBe('vendor');
      expect(partnerReferralAxisForUserType('DELIVERY')).toBe('courier');
      expect(partnerReferralAxisForUserType('PARTNER')).toBeNull();
    });
  });

  describe('evaluatePartnerReferralAttach', () => {
    const base = {
      targetType: 'USER',
      targetUserId: 'u1',
      partnerUserId: 'p1',
    };

    it('autorise un premier attach', () => {
      expect(evaluatePartnerReferralAttach(base)).toEqual({
        ok: true,
        willOverride: false,
      });
    });

    it('refuse type PARTNER', () => {
      expect(
        evaluatePartnerReferralAttach({ ...base, targetType: 'PARTNER' }),
      ).toEqual({ ok: false, reason: 'partner_referral_not_for_partner' });
    });

    it('refuse self-referral', () => {
      expect(
        evaluatePartnerReferralAttach({
          ...base,
          partnerUserId: 'u1',
        }),
      ).toEqual({ ok: false, reason: 'partner_referral_self' });
    });

    it('refuse déjà attaché sans force', () => {
      expect(
        evaluatePartnerReferralAttach({
          ...base,
          existingPartnerUserId: 'p0',
          force: false,
        }),
      ).toEqual({ ok: false, reason: 'partner_referral_already_set' });
    });

    it('autorise override admin avec force', () => {
      expect(
        evaluatePartnerReferralAttach({
          ...base,
          existingPartnerUserId: 'p0',
          force: true,
        }),
      ).toEqual({ ok: true, willOverride: true });
    });
  });
});
