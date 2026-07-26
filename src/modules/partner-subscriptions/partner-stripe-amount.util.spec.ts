import {
  partnerPriceToStripeMinorUnits,
  partnerStripeMinimumMinorUnits,
} from './partner-stripe-amount.util';

describe('partner-stripe-amount.util', () => {
  it('XAF montants entiers (×1) : 10_000 FCFA → 10_000', () => {
    expect(partnerPriceToStripeMinorUnits(10_000, 1)).toBe(10_000);
  });

  it('ne multiplie plus à tort par 100 en XAF', () => {
    // Régression : dollarsToCents(10000) === 1_000_000
    expect(partnerPriceToStripeMinorUnits(10_000, 1)).not.toBe(1_000_000);
  });

  it('CAD centimes (×100) : 29.99 → 2999', () => {
    expect(partnerPriceToStripeMinorUnits(29.99, 100)).toBe(2999);
  });

  it('minimum Stripe selon facteur', () => {
    expect(partnerStripeMinimumMinorUnits(1)).toBe(100);
    expect(partnerStripeMinimumMinorUnits(100)).toBe(50);
  });
});
