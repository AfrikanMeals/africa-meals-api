import {
  convertChargeMinorToSettlementMinor,
  resolveChargeSettlementExchangeRate,
} from './stripe-charge-settlement-fx.util';

describe('stripe-charge-settlement-fx.util', () => {
  it('keeps amount when charge and settlement currencies match', () => {
    expect(
      convertChargeMinorToSettlementMinor(1500, { exchangeRate: 1 }),
    ).toBe(1500);
    expect(
      resolveChargeSettlementExchangeRate({
        chargeCurrency: 'cad',
        settlementCurrency: 'CAD',
      }),
    ).toBe(1);
  });

  it('uses Stripe exchange_rate to convert XAF → CAD', () => {
    // Ex. 5000 XAF → ~11.25 CAD (1125 cents) ⇒ rate ≈ 0.225
    const rate = resolveChargeSettlementExchangeRate({
      chargeCurrency: 'xaf',
      settlementCurrency: 'cad',
      exchangeRate: 0.225,
    });
    expect(rate).toBe(0.225);
    expect(convertChargeMinorToSettlementMinor(5000, { exchangeRate: rate })).toBe(
      1125,
    );
  });

  it('infers rate from charge vs settlement amounts when exchange_rate missing', () => {
    const rate = resolveChargeSettlementExchangeRate({
      chargeCurrency: 'xaf',
      settlementCurrency: 'cad',
      chargeAmountMinor: 10000,
      settlementAmountMinor: 2200,
    });
    expect(rate).toBeCloseTo(0.22, 5);
    expect(
      convertChargeMinorToSettlementMinor(1000, { exchangeRate: rate }),
    ).toBe(220);
  });
});
