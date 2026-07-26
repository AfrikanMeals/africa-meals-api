import { isPartnerReferralCodeEligible } from './partner-referral-eligibility.util';

describe('isPartnerReferralCodeEligible', () => {
  it('accepte PARTNER même si candidature non APPROVED', () => {
    expect(
      isPartnerReferralCodeEligible({
        partnerUserType: 'PARTNER',
        applicationStatus: 'AWAITING_REVIEW',
      }),
    ).toBe(true);
    expect(
      isPartnerReferralCodeEligible({
        partnerUserType: 'PARTNER',
        applicationStatus: 'DRAFT',
      }),
    ).toBe(true);
    expect(
      isPartnerReferralCodeEligible({
        partnerUserType: 'PARTNER',
        applicationStatus: 'APPROVED',
      }),
    ).toBe(true);
  });

  it('refuse SUSPENDED ou non-PARTNER', () => {
    expect(
      isPartnerReferralCodeEligible({
        partnerUserType: 'PARTNER',
        applicationStatus: 'SUSPENDED',
      }),
    ).toBe(false);
    expect(
      isPartnerReferralCodeEligible({
        partnerUserType: 'USER',
        applicationStatus: 'APPROVED',
      }),
    ).toBe(false);
    expect(
      isPartnerReferralCodeEligible({
        partnerUserType: null,
        applicationStatus: 'APPROVED',
      }),
    ).toBe(false);
  });
});
