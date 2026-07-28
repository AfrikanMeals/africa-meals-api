import {
  convertCentsToCad,
  convertMajorToCad,
  sumCentsByCurrencyToCad,
  type CadFxRates,
} from './gain-estimate-cad-fx.util';

const rates: CadFxRates = {
  date: '2026-07-28',
  unitsPerCad: { usd: 0.73, xaf: 450 },
};

describe('gain-estimate-cad-fx.util', () => {
  it('CAD inchangé', () => {
    expect(convertMajorToCad(12.5, 'CAD', rates)).toBe(12.5);
    expect(convertCentsToCad(250, 'cad', rates)).toBe(2.5);
  });

  it('convertit via unitsPerCad', () => {
    // 73 USD / 0.73 = 100 CAD
    expect(convertMajorToCad(73, 'USD', rates)).toBeCloseTo(100, 5);
  });

  it('null sans taux pour devise inconnue', () => {
    expect(convertMajorToCad(10, 'EUR', rates)).toBeNull();
    expect(convertMajorToCad(10, 'USD', null)).toBeNull();
  });

  it('sumCentsByCurrencyToCad agrège + unconverted', () => {
    const result = sumCentsByCurrencyToCad(
      [
        { currency: 'CAD', amountCents: 10000 },
        { currency: 'EUR', amountCents: 500 },
      ],
      rates,
      'order_commission',
    );
    expect(result.cad).toBe(100);
    expect(result.unconverted).toEqual([
      { currency: 'EUR', amountMajor: 5, source: 'order_commission' },
    ]);
  });
});
