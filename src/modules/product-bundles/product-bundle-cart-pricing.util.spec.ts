import {
  allocateBundleCartLinePrices,
  distributeProportionally,
} from './product-bundle-cart-pricing.util';

describe('distributeProportionally', () => {
  it('somme exacte du total (arrondis cents)', () => {
    const parts = distributeProportionally([10, 8], 14.4);
    expect(parts.reduce((s, p) => s + p, 0)).toBeCloseTo(14.4, 10);
    expect(parts[0]).toBeCloseTo(8, 2);
    expect(parts[1]).toBeCloseTo(6.4, 2);
  });

  it('partage égal si poids nuls', () => {
    const parts = distributeProportionally([0, 0, 0], 3);
    expect(parts.reduce((s, p) => s + p, 0)).toBeCloseTo(3, 10);
    expect(parts.every((p) => p === 1)).toBe(true);
  });
});

describe('allocateBundleCartLinePrices', () => {
  // Remise % : bases remisées, extras inchangés, somme = bundlePrice + extras.
  it('répartit le prix combo et conserve les extras', () => {
    const result = allocateBundleCartLinePrices(
      [
        { lineId: 'a', baseCustomerPrice: 10, extrasCustomerPrice: 2 },
        { lineId: 'b', baseCustomerPrice: 8, extrasCustomerPrice: 0 },
      ],
      'percent',
      20,
    );
    // bundlePrice = 14.4 → 8 + 6.4 ; + extras 2 sur a
    expect(result[0].unitPrice).toBeCloseTo(10, 2); // 8 + 2
    expect(result[1].unitPrice).toBeCloseTo(6.4, 2);
    const basesSum = result.reduce((s, r) => s + r.allocatedBase, 0);
    expect(basesSum).toBeCloseTo(14.4, 10);
    const total = result.reduce((s, r) => s + r.unitPrice, 0);
    expect(total).toBeCloseTo(16.4, 10);
  });

  it('applique une remise fixe sur les bases seulement', () => {
    const result = allocateBundleCartLinePrices(
      [
        { lineId: 'a', baseCustomerPrice: 12, extrasCustomerPrice: 1 },
        { lineId: 'b', baseCustomerPrice: 6, extrasCustomerPrice: 0.5 },
      ],
      'fixed',
      5,
    );
    // original 18 → bundle 13 ; extras 1.5 → total 14.5
    const basesSum = result.reduce((s, r) => s + r.allocatedBase, 0);
    expect(basesSum).toBeCloseTo(13, 10);
    const total = result.reduce((s, r) => s + r.unitPrice, 0);
    expect(total).toBeCloseTo(14.5, 10);
  });
});
