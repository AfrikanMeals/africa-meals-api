import {
  fromStripeMinorUnits,
  isStripeZeroDecimalCurrency,
  stripeAmountFactor,
  stripeMinimumChargeMinorUnits,
  toStripeMinorUnits,
} from './stripe-currency-amount.util';

describe('stripe-currency-amount.util', () => {
  it('detects XAF as zero-decimal', () => {
    expect(isStripeZeroDecimalCurrency('XAF')).toBe(true);
    expect(stripeAmountFactor('XAF')).toBe(1);
    expect(toStripeMinorUnits(1071.45, 'XAF')).toBe(1071);
  });

  it('uses centimes for CAD', () => {
    expect(stripeAmountFactor('CAD')).toBe(100);
    expect(toStripeMinorUnits(7.5, 'CAD')).toBe(750);
    expect(fromStripeMinorUnits(750, 'CAD')).toBe(7.5);
  });

  it('honours admin override', () => {
    expect(stripeAmountFactor('CAD', true)).toBe(1);
    expect(stripeAmountFactor('XAF', false)).toBe(100);
  });

  it('sets minimum charge by currency type', () => {
    expect(stripeMinimumChargeMinorUnits('CAD')).toBe(50);
    expect(stripeMinimumChargeMinorUnits('XAF')).toBe(100);
  });
});
