import { isStoreCouponCodeWithAmPrefix } from './coupon-code.util';

describe('isStoreCouponCodeWithAmPrefix', () => {
  it('accepte AM- + suffixe valide', () => {
    expect(isStoreCouponCodeWithAmPrefix('AM-ABCDEFGH')).toBe(true);
    expect(isStoreCouponCodeWithAmPrefix('am-xy12zw34')).toBe(true);
  });

  it('refuse sans préfixe ou suffixe trop court', () => {
    expect(isStoreCouponCodeWithAmPrefix('ETE2026')).toBe(false);
    expect(isStoreCouponCodeWithAmPrefix('AM-AB')).toBe(false);
    expect(isStoreCouponCodeWithAmPrefix('')).toBe(false);
  });
});
