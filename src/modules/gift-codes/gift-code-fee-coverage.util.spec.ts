import {
  computePlatformGiftCoverageSplit,
  normalizeGiftFeeCoverage,
  vendorGoodsCentsFromChargedAndGift,
} from './gift-code-fee-coverage.util';

describe('normalizeGiftFeeCoverage', () => {
  it('defaults missing/legacy to STORE', () => {
    expect(normalizeGiftFeeCoverage(undefined)).toBe('STORE');
    expect(normalizeGiftFeeCoverage(null)).toBe('STORE');
    expect(normalizeGiftFeeCoverage('')).toBe('STORE');
    expect(normalizeGiftFeeCoverage('store')).toBe('STORE');
  });

  it('accepts PLATFORM case-insensitively', () => {
    expect(normalizeGiftFeeCoverage('PLATFORM')).toBe('PLATFORM');
    expect(normalizeGiftFeeCoverage('platform')).toBe('PLATFORM');
  });
});

describe('vendorGoodsCentsFromChargedAndGift', () => {
  it('sums charged + gift (STORE identity when gift=0)', () => {
    expect(vendorGoodsCentsFromChargedAndGift(1000, 0)).toBe(1000);
    expect(vendorGoodsCentsFromChargedAndGift(800, 200)).toBe(1000);
  });
});

describe('computePlatformGiftCoverageSplit', () => {
  it('fee ≥ gift → topUp 0 and fee reduced by gift', () => {
    // vendorGoods=1000, fee=300, gift=200 → desired=700, feeFromCharge=100, fromCharge=700
    const split = computePlatformGiftCoverageSplit({
      chargedGoodsCents: 800,
      giftCents: 200,
      platformFeeOnVendorGoodsCents: 300,
    });
    expect(split.vendorGoodsCents).toBe(1000);
    expect(split.platformFeeFromChargeCents).toBe(100);
    expect(split.fromChargeVendorBeforeStripeCents).toBe(700);
    expect(split.desiredVendorBeforeStripeCents).toBe(700);
    expect(split.topUpCents).toBe(0);
  });

  it('gift > fee → topUp = remaining gap', () => {
    // vendorGoods=1000, fee=100, gift=300 → desired=900, feeFromCharge=0, fromCharge=700, topUp=200
    const split = computePlatformGiftCoverageSplit({
      chargedGoodsCents: 700,
      giftCents: 300,
      platformFeeOnVendorGoodsCents: 100,
    });
    expect(split.platformFeeFromChargeCents).toBe(0);
    expect(split.fromChargeVendorBeforeStripeCents).toBe(700);
    expect(split.desiredVendorBeforeStripeCents).toBe(900);
    expect(split.topUpCents).toBe(200);
  });

  it('never returns negative topUp', () => {
    const split = computePlatformGiftCoverageSplit({
      chargedGoodsCents: 1000,
      giftCents: 0,
      platformFeeOnVendorGoodsCents: 50,
    });
    expect(split.topUpCents).toBeGreaterThanOrEqual(0);
    expect(split.topUpCents).toBe(0);
  });
});
