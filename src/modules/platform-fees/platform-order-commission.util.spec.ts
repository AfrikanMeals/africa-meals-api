import {
  adjustStoredCatalogUnitPrices,
  applyCommissionMarkupToPriceComponents,
  markupCatalogListUnitPrices,
  markupCatalogRowComponentPrices,
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

describe('applyCommissionMarkupToPriceComponents', () => {
  it('on_payout laisse base et extras inchangés', () => {
    const out = applyCommissionMarkupToPriceComponents(
      10,
      [2, 3],
      percentConfig(15),
      'CAD',
      'on_payout',
    );
    expect(out.customerBase).toBe(10);
    expect(out.customerExtras).toEqual([2, 3]);
    expect(out.commissionAmount).toBe(0);
  });

  it('add_to_price majore base et extras au %', () => {
    const out = applyCommissionMarkupToPriceComponents(
      10,
      [2],
      percentConfig(10),
      'CAD',
      'add_to_price',
    );
    expect(out.customerBase).toBe(11);
    expect(out.customerExtras[0]).toBeCloseTo(2.2, 5);
    expect(out.customerTotal).toBeCloseTo(13.2, 5);
  });
});

describe('markupCatalogRowComponentPrices', () => {
  it('majore variantes et priceDelta en add_to_price', () => {
    const row: Record<string, unknown> = {
      price: 10,
      variants: [{ label: 'L', price: 12, discountPrice: 0 }],
      complements: [
        {
          title: 'Sauce',
          options: [{ label: 'Extra', priceDelta: 2, isDefault: true }],
        },
      ],
      supplements: [{ name: 'Fromage', price: 1 }],
    };
    markupCatalogRowComponentPrices({
      row,
      config: percentConfig(10),
      currency: 'CAD',
      strategy: 'add_to_price',
      vendorBasePrice: 10,
    });
    const v = (row.variants as Array<Record<string, unknown>>)[0];
    expect(v.price).toBe(13.2);
    const opt = (
      (row.complements as Array<Record<string, unknown>>)[0]
        .options as Array<Record<string, unknown>>
    )[0];
    expect(opt.priceDelta).toBeCloseTo(2.2, 5);
    expect(
      (row.supplements as Array<Record<string, unknown>>)[0].price,
    ).toBeCloseTo(1.1, 5);
  });

  it('no-op en on_payout', () => {
    const row: Record<string, unknown> = {
      variants: [{ price: 12 }],
      supplements: [{ price: 1 }],
    };
    markupCatalogRowComponentPrices({
      row,
      config: percentConfig(10),
      currency: 'CAD',
      strategy: 'on_payout',
      vendorBasePrice: 10,
    });
    expect((row.variants as Array<Record<string, unknown>>)[0].price).toBe(12);
    expect((row.supplements as Array<Record<string, unknown>>)[0].price).toBe(
      1,
    );
  });
});
