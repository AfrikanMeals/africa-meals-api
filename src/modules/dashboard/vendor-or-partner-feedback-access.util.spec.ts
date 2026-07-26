import { UserTypeEnum } from '@schemas/user.schema';
import { canSubmitVendorOrPartnerFeedback } from './vendor-or-partner-feedback-access.util';

describe('canSubmitVendorOrPartnerFeedback', () => {
  it('autorise VENDOR et PARTNER', () => {
    expect(canSubmitVendorOrPartnerFeedback(UserTypeEnum.VENDOR)).toBe(true);
    expect(canSubmitVendorOrPartnerFeedback(UserTypeEnum.PARTNER)).toBe(true);
    expect(canSubmitVendorOrPartnerFeedback('partner')).toBe(true);
  });

  it('refuse USER, DELIVERY, ADMIN et vide', () => {
    expect(canSubmitVendorOrPartnerFeedback(UserTypeEnum.USER)).toBe(false);
    expect(canSubmitVendorOrPartnerFeedback(UserTypeEnum.DELIVERY)).toBe(
      false,
    );
    expect(canSubmitVendorOrPartnerFeedback(UserTypeEnum.ADMIN)).toBe(false);
    expect(canSubmitVendorOrPartnerFeedback(null)).toBe(false);
    expect(canSubmitVendorOrPartnerFeedback('')).toBe(false);
  });
});
