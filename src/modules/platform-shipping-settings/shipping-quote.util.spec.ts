import {
  computePlatformShippingFeeFromDistance,
  pickBillableDistanceKm,
  resolvePlatformRangePricing,
} from './shipping-quote.util';

describe('shipping-quote.util range basePrice', () => {
  const settings = {
    perKmRate: 95,
    deliveryBasePrice: 500,
    maxDeliveryRadiusKm: 15,
    ranges: [
      { minKm: 0, maxKm: 5, basePrice: 700, fee: 250 },
      { minKm: 5, maxKm: 10, fee: 80 },
    ],
  };

  it('uses range basePrice + distance × range per-km fee when tranche matches', () => {
    const result = computePlatformShippingFeeFromDistance(settings, 3);
    expect(result.deliverable).toBe(true);
    expect(result.deliveryBasePrice).toBe(700);
    expect(result.rangeFlat).toBe(0);
    expect(result.rangePerKmRate).toBe(250);
    expect(result.perKmRateEffective).toBe(250);
    expect(result.perKmComponent).toBe(750);
    expect(result.total).toBe(1450);
  });

  it('falls back to global deliveryBasePrice when tranche has no basePrice', () => {
    const result = computePlatformShippingFeeFromDistance(settings, 7);
    expect(result.deliveryBasePrice).toBe(500);
    expect(result.rangePerKmRate).toBe(80);
    expect(result.perKmRateEffective).toBe(80);
    expect(result.perKmComponent).toBe(560);
    expect(result.total).toBe(1060);
  });

  it('uses global perKmRate when no tranche matches', () => {
    const result = computePlatformShippingFeeFromDistance(settings, 12);
    expect(result.deliveryBasePrice).toBe(500);
    expect(result.rangePerKmRate).toBe(0);
    expect(result.perKmRateEffective).toBe(95);
    expect(result.perKmComponent).toBe(1140);
    expect(result.total).toBe(1640);
  });

  it('pickBillableDistanceKm prefers driving route over haversine (Gmaps gap)', () => {
    expect(pickBillableDistanceKm(2.853, 4.6)).toBe(4.6);
    expect(pickBillableDistanceKm(2.853, null)).toBe(2.853);
    expect(pickBillableDistanceKm(2.853, 2.8)).toBe(2.853);
  });

  it('resolvePlatformRangePricing returns global km rate outside tranches', () => {
    const pricing = resolvePlatformRangePricing(
      [{ minKm: 0, maxKm: 5, basePrice: 500, fee: 250 }],
      12,
      100,
      95,
    );
    expect(pricing.deliveryBasePrice).toBe(100);
    expect(pricing.perKmRateEffective).toBe(95);
    expect(pricing.matchedRange).toBeNull();
  });
});
