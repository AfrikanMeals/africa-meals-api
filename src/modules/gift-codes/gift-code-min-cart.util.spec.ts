import {
  isGiftCodeMinCartMet,
  normalizeGiftMinCartAmount,
} from './gift-code-min-cart.util';

describe('normalizeGiftMinCartAmount', () => {
  it('defaults missing/invalid to 0', () => {
    expect(normalizeGiftMinCartAmount(undefined)).toBe(0);
    expect(normalizeGiftMinCartAmount(null)).toBe(0);
    expect(normalizeGiftMinCartAmount(-5)).toBe(0);
    expect(normalizeGiftMinCartAmount(Number.NaN)).toBe(0);
  });

  it('keeps positive amounts (2 decimals)', () => {
    expect(normalizeGiftMinCartAmount(25)).toBe(25);
    expect(normalizeGiftMinCartAmount(19.999)).toBe(20);
  });
});

describe('isGiftCodeMinCartMet', () => {
  it('0 / absent = always met (no regression)', () => {
    expect(isGiftCodeMinCartMet(0, 0)).toBe(true);
    expect(isGiftCodeMinCartMet(5, undefined)).toBe(true);
    expect(isGiftCodeMinCartMet(0, null)).toBe(true);
  });

  it('rejects when eligible subtotal below min', () => {
    expect(isGiftCodeMinCartMet(19.99, 20)).toBe(false);
    expect(isGiftCodeMinCartMet(0, 10)).toBe(false);
  });

  it('accepts when eligible subtotal >= min', () => {
    expect(isGiftCodeMinCartMet(20, 20)).toBe(true);
    expect(isGiftCodeMinCartMet(50.5, 20)).toBe(true);
  });
});
