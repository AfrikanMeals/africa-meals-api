import {
  majorAmountFromStripeCheckoutTotal,
  resolveVendorBillingStripeCheckoutAmount,
} from './vendor-billing-stripe-checkout.util';

describe('resolveVendorBillingStripeCheckoutAmount', () => {
  it('XAF : unités entières (pas ×100) — boutique CM', () => {
    const r = resolveVendorBillingStripeCheckoutAmount({
      amountMajor: 2050.77,
      currency: 'XAF',
    });
    expect(r.currencyLower).toBe('xaf');
    expect(r.amountMajor).toBe(2051);
    expect(r.unitAmount).toBe(2051);
    expect(r.meetsMinimum).toBe(true);
  });

  it('CAD : centimes', () => {
    const r = resolveVendorBillingStripeCheckoutAmount({
      amountMajor: 20.5,
      currency: 'CAD',
    });
    expect(r.currencyLower).toBe('cad');
    expect(r.unitAmount).toBe(2050);
    expect(r.meetsMinimum).toBe(true);
  });

  it('refuse montants sous le minimum Stripe', () => {
    expect(
      resolveVendorBillingStripeCheckoutAmount({
        amountMajor: 0.1,
        currency: 'CAD',
      }).meetsMinimum,
    ).toBe(false);
    expect(
      resolveVendorBillingStripeCheckoutAmount({
        amountMajor: 50,
        currency: 'XAF',
      }).meetsMinimum,
    ).toBe(false);
  });
});

describe('majorAmountFromStripeCheckoutTotal', () => {
  it('reconstruit XAF / CAD depuis amount_total', () => {
    expect(majorAmountFromStripeCheckoutTotal(2051, 'xaf')).toBe(2051);
    expect(majorAmountFromStripeCheckoutTotal(205077, 'cad')).toBe(2050.77);
  });
});
