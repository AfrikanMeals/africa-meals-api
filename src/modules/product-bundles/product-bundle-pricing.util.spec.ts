import { computeBundlePricing } from './product-bundle-pricing.util';

describe('computeBundlePricing', () => {
  // Remise pourcentage standard — la plus fréquente (ex. 15 % sur 2 items)
  it('calcule une remise pourcentage correctement', () => {
    const result = computeBundlePricing({
      items: [{ customerPrice: 10 }, { customerPrice: 8 }],
      discountType: 'percent',
      discountValue: 20,
    });
    expect(result.originalTotal).toBe(18);
    expect(result.discountAmount).toBe(3.6);
    expect(result.bundlePrice).toBe(14.4);
    expect(result.savingsPercent).toBe(20);
    expect(result.badgeFr).toBe('-20 %');
    expect(result.badgeEn).toBe('-20%');
  });

  // Remise fixe — ex. 5 $ de remise sur un combo
  it('calcule une remise fixe correctement', () => {
    const result = computeBundlePricing({
      items: [{ customerPrice: 12 }, { customerPrice: 6 }],
      discountType: 'fixed',
      discountValue: 5,
    });
    expect(result.originalTotal).toBe(18);
    expect(result.discountAmount).toBe(5);
    expect(result.bundlePrice).toBe(13);
    expect(result.savingsPercent).toBeCloseTo(27.78, 1);
  });

  // Remise fixe dépassant le total — plafonnée au total (pas de prix négatif)
  it('plafonne la remise fixe au total (pas de prix négatif)', () => {
    const result = computeBundlePricing({
      items: [{ customerPrice: 3 }, { customerPrice: 2 }],
      discountType: 'fixed',
      discountValue: 100,
    });
    expect(result.originalTotal).toBe(5);
    expect(result.discountAmount).toBe(5);
    expect(result.bundlePrice).toBe(0);
    expect(result.savingsPercent).toBe(100);
  });

  // Pourcentage plafonné à 99 % — empêche un bundle gratuit
  it('plafonne le pourcentage à 99 %', () => {
    const result = computeBundlePricing({
      items: [{ customerPrice: 10 }, { customerPrice: 10 }],
      discountType: 'percent',
      discountValue: 150,
    });
    expect(result.discountAmount).toBeCloseTo(19.8);
    expect(result.bundlePrice).toBeCloseTo(0.2);
  });

  // Total à zéro — pas de crash, retour neutre
  it('gère un total à zéro sans crash', () => {
    const result = computeBundlePricing({
      items: [{ customerPrice: 0 }, { customerPrice: 0 }],
      discountType: 'percent',
      discountValue: 20,
    });
    expect(result.originalTotal).toBe(0);
    expect(result.bundlePrice).toBe(0);
    expect(result.savingsPercent).toBe(0);
  });

  // Plusieurs items (3+ items) — vérifier la somme
  it('gère 3+ items correctement', () => {
    const result = computeBundlePricing({
      items: [
        { customerPrice: 10 },
        { customerPrice: 5 },
        { customerPrice: 3 },
      ],
      discountType: 'percent',
      discountValue: 10,
    });
    expect(result.originalTotal).toBe(18);
    expect(result.discountAmount).toBe(1.8);
    expect(result.bundlePrice).toBe(16.2);
  });

  // Items négatifs ignorés (prix min 0 via Math.max)
  it('ignore les prix négatifs dans les items', () => {
    const result = computeBundlePricing({
      items: [{ customerPrice: 10 }, { customerPrice: -5 }],
      discountType: 'percent',
      discountValue: 10,
    });
    expect(result.originalTotal).toBe(10);
  });
});
