import {
  resolveBundleProductVendorUnitPrice,
} from './product-bundle-vendor-unit-price.util';

describe('resolveBundleProductVendorUnitPrice', () => {
  it('utilise le prix produit sans variantes', () => {
    expect(
      resolveBundleProductVendorUnitPrice({ price: 5000, discountPrice: 0 }),
    ).toBe(5000);
  });

  it('privilégie discountPrice produit', () => {
    expect(
      resolveBundleProductVendorUnitPrice({
        price: 5000,
        discountPrice: 4000,
      }),
    ).toBe(4000);
  });

  it('utilise la variante isDefault (aligné pré-sélection mobile)', () => {
    expect(
      resolveBundleProductVendorUnitPrice({
        price: 9000,
        variants: [
          { label: '1/2', price: 7000, isDefault: false },
          { label: '1/4', price: 5000, isDefault: true },
        ],
      }),
    ).toBe(5000);
  });

  it('respecte preferredVariantLabel', () => {
    expect(
      resolveBundleProductVendorUnitPrice(
        {
          price: 9000,
          variants: [
            { label: '1/4', price: 5000, isDefault: true },
            { label: 'Entier', price: 9000, isDefault: false },
          ],
        },
        'Entier',
      ),
    ).toBe(9000);
  });

  it('applique discountPrice variante si inférieur', () => {
    expect(
      resolveBundleProductVendorUnitPrice({
        price: 5000,
        variants: [
          { label: '1/4', price: 5000, discountPrice: 4500, isDefault: true },
        ],
      }),
    ).toBe(4500);
  });
});
