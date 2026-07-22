import {
  isCartSimulatorCatalogProductId,
  normalizeCartSimulatorItems,
  resolveCartSimulatorCurrency,
  resolveCartSimulatorRegionCode,
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
