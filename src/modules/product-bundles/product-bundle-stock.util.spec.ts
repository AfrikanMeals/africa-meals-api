import { maxBundleOrderQuantity } from './product-bundles.service';

describe('maxBundleOrderQuantity', () => {
  it('retourne 0 pour stock épuisé', () => {
    expect(maxBundleOrderQuantity(0)).toBe(0);
  });

  it('retourne le stock entier pour une quantité positive', () => {
    expect(maxBundleOrderQuantity(7)).toBe(7);
    expect(maxBundleOrderQuantity(7.9)).toBe(7);
  });

  it('traite null/undefined comme illimité (legacy)', () => {
    expect(maxBundleOrderQuantity(null)).toBe(9999);
    expect(maxBundleOrderQuantity(undefined)).toBe(9999);
  });
});
