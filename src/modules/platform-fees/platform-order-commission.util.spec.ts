import {
  adjustStoredCatalogUnitPrices,
  markupCatalogListUnitPrices,
  type OrderCommissionConfig,
} from './platform-order-commission.util';

const percentConfig = (percent: number): OrderCommissionConfig => ({
  tierBasis: 'unit_price',
  tiers: [],
  fallbackMode: 'percent',
  fallbackFixed: 0,
  fallbackPercent: percent,
});

describe('markupCatalogListUnitPrices', () => {
  it('laisse le prix vendeur inchangé en on_payout', () => {
    const out = markupCatalogListUnitPrices({
      vendorPrice: 16.99,
      vendorDiscountPrice: 10,
      config: percentConfig(15),
      currency: 'CAD',
      strategy: 'on_payout',
    });
    expect(out.price).toBe(16.99);
    expect(out.discountPrice).toBe(10);
  });

  it('majore prix et promo en add_to_price (percent)', () => {
    const out = markupCatalogListUnitPrices({
      vendorPrice: 16.99,
      vendorDiscountPrice: 10,
      config: percentConfig(15),
      currency: 'CAD',
      strategy: 'add_to_price',
    });
    // 16.99 * 1.15 → commission 2.55 → client 19.54 (cents CAD)
    expect(out.price).toBe(19.54);
    expect(out.discountPrice).toBe(11.5);
  });

  it('ne majore pas une promo à 0', () => {
    const out = markupCatalogListUnitPrices({
      vendorPrice: 16.99,
      vendorDiscountPrice: 0,
      config: percentConfig(15),
      currency: 'CAD',
      strategy: 'add_to_price',
    });
    expect(out.price).toBe(19.54);
    expect(out.discountPrice).toBe(0);
  });
});

describe('adjustStoredCatalogUnitPrices', () => {
  it('assume_customer_prices retire la commission (19.54 → ~16.99)', () => {
    const out = adjustStoredCatalogUnitPrices({
      vendorPrice: 19.54,
      vendorDiscountPrice: 11.5,
      config: percentConfig(15),
      currency: 'CAD',
      mode: 'assume_customer_prices',
    });
    expect(out.price).toBeCloseTo(16.99, 1);
    expect(out.discountPrice).toBeCloseTo(10, 1);
  });

  it('assume_vendor_net majore le net (16.99 → 19.54)', () => {
    const out = adjustStoredCatalogUnitPrices({
      vendorPrice: 16.99,
      vendorDiscountPrice: 10,
      config: percentConfig(15),
      currency: 'CAD',
      mode: 'assume_vendor_net',
    });
    expect(out.price).toBe(19.54);
    expect(out.discountPrice).toBe(11.5);
  });
});
