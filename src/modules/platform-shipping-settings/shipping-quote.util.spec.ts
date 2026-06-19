import {
  computePlatformShippingFeeFromDistance,
  resolvePlatformRangePricing,
} from './shipping-quote.util';

describe('shipping-quote.util range basePrice', () => {
  const settings = {
    perKmRate: 1,
    deliveryBasePrice: 100,
    maxDeliveryRadiusKm: 50,
    ranges: [
      { minKm: 0, maxKm: 5, basePrice: 200, fee: 50 },
      { minKm: 5, maxKm: 10, fee: 80 },
    ],
  };

  it('uses range basePrice + fee + km when tranche defines basePrice', () => {
    const result = computePlatformShippingFeeFromDistance(settings, 3);
    expect(result.deliverable).toBe(true);
    expect(result.deliveryBasePrice).toBe(200);
    expect(result.rangeFlat).toBe(50);
    expect(result.perKmComponent).toBe(3);
    expect(result.total).toBe(253);
  });

  it('falls back to global deliveryBasePrice when tranche has no basePrice', () => {
    const result = computePlatformShippingFeeFromDistance(settings, 7);
    expect(result.deliveryBasePrice).toBe(100);
    expect(result.rangeFlat).toBe(80);
    expect(result.perKmComponent).toBe(7);
    expect(result.total).toBe(187);
  });

  it('uses global base when no tranche matches', () => {
    const pricing = resolvePlatformRangePricing(
      [{ minKm: 0, maxKm: 5, basePrice: 500, fee: 0 }],
      12,
      100,
    );
    expect(pricing.deliveryBasePrice).toBe(100);
    expect(pricing.rangeFlat).toBe(0);
  });
});
