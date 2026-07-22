import {
  cartSimulatorCouponFactor,
  isCartSimulatorCatalogProductId,
  normalizeCartSimulatorItems,
  resolveCartSimulatorCurrency,
  resolveCartSimulatorRegionCode,
  stackVendorNetAfterFeesCents,
} from './cart-simulator-items.util';

describe('cart-simulator-items.util', () => {
  describe('isCartSimulatorCatalogProductId', () => {
    it('accepte un ObjectId 24 hex', () => {
      expect(isCartSimulatorCatalogProductId('507f1f77bcf86cd799439011')).toBe(
        true,
      );
    });

    it('refuse custom / vide', () => {
      expect(isCartSimulatorCatalogProductId('custom-1')).toBe(false);
      expect(isCartSimulatorCatalogProductId('')).toBe(false);
    });
  });

  describe('normalizeCartSimulatorItems', () => {
    it('mixte catalogue + prix libre', () => {
      const lines = normalizeCartSimulatorItems([
        { productId: '507f1f77bcf86cd799439011', quantity: 2 },
        { title: 'Menu du jour', unitPrice: 3500, quantity: 1 },
      ]);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatchObject({
        kind: 'catalog',
        productId: '507f1f77bcf86cd799439011',
        quantity: 2,
      });
      expect(lines[1]).toMatchObject({
        kind: 'custom',
        title: 'Menu du jour',
        unitPrice: 3500,
        quantity: 1,
      });
    });

    it('rejette une liste vide / invalide', () => {
      expect(() => normalizeCartSimulatorItems([])).toThrow(
        'cart_simulator_no_valid_items',
      );
      expect(() =>
        normalizeCartSimulatorItems([{ productId: 'x', quantity: 1 }]),
      ).toThrow('cart_simulator_no_valid_items');
    });
  });

  describe('cartSimulatorCouponFactor', () => {
    it('réduit proportionnellement les lignes', () => {
      expect(cartSimulatorCouponFactor(100, 20)).toBeCloseTo(0.8);
      expect(cartSimulatorCouponFactor(0, 10)).toBe(1);
      expect(cartSimulatorCouponFactor(50, 100)).toBe(0);
    });
  });

  describe('stackVendorNetAfterFeesCents', () => {
    it('empile Stripe puis payout sans négatif', () => {
      expect(
        stackVendorNetAfterFeesCents({
          vendorNetAfterCommissionCents: 1000,
          stripeFeeShareCents: 59,
          payoutFeeCents: 100,
        }),
      ).toEqual({
        netAfterStripeCents: 941,
        netAfterPayoutCents: 841,
      });
      expect(
        stackVendorNetAfterFeesCents({
          vendorNetAfterCommissionCents: 50,
          stripeFeeShareCents: 100,
          payoutFeeCents: 10,
        }),
      ).toEqual({
        netAfterStripeCents: 0,
        netAfterPayoutCents: 0,
      });
    });
  });

  describe('resolveCartSimulatorRegionCode', () => {
    it('priorise store.region puis address.countryCode', () => {
      expect(
        resolveCartSimulatorRegionCode({
          region: 'CM',
          address: { countryCode: 'CA' },
        }),
      ).toBe('CM');
      expect(
        resolveCartSimulatorRegionCode({
          region: '',
          address: { countryCode: 'CM' },
        }),
      ).toBe('CM');
    });
  });

  describe('resolveCartSimulatorCurrency', () => {
    it('priorise la devise région (CM → XAF) sur CAD legacy boutique', () => {
      expect(
        resolveCartSimulatorCurrency({
          regionCurrency: 'XAF',
          storeCurrency: 'CAD',
        }),
      ).toBe('XAF');
    });

    it('ignore CAD legacy si région hors CA (repli fallback explicite)', () => {
      expect(
        resolveCartSimulatorCurrency({
          regionCurrency: null,
          storeCurrency: 'CAD',
          regionCode: 'CM',
          fallback: 'XAF',
        }),
      ).toBe('XAF');
    });

    it('repli store.currency puis CAD', () => {
      expect(
        resolveCartSimulatorCurrency({
          regionCurrency: null,
          storeCurrency: 'EUR',
        }),
      ).toBe('EUR');
      expect(
        resolveCartSimulatorCurrency({
          regionCurrency: '',
          storeCurrency: '',
        }),
      ).toBe('CAD');
    });
  });
});
