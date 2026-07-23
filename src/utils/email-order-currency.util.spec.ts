import {
  formatEmailMoney,
  resolveOrderDisplayCurrency,
} from './email-order-currency.util';

describe('email-order-currency.util', () => {
  describe('resolveOrderDisplayCurrency', () => {
    it('priorise order.currency', () => {
      expect(
        resolveOrderDisplayCurrency({
          orderCurrency: 'XAF',
          storeCurrency: 'CAD',
          regionCode: 'CA',
        }),
      ).toBe('XAF');
    });

    it('utilise regionCurrency puis ignore CAD legacy hors CA', () => {
      expect(
        resolveOrderDisplayCurrency({
          storeCurrency: 'CAD',
          regionCode: 'CM',
          regionCurrency: 'XAF',
        }),
      ).toBe('XAF');
      expect(
        resolveOrderDisplayCurrency({
          storeCurrency: 'CAD',
          regionCode: 'CM',
        }),
      ).toBe('XAF');
    });

    it('garde CAD pour boutique Canada', () => {
      expect(
        resolveOrderDisplayCurrency({
          storeCurrency: 'CAD',
          regionCode: 'CA',
        }),
      ).toBe('CAD');
    });

    it('ignore CAD legacy sur order.currency hors CA', () => {
      expect(
        resolveOrderDisplayCurrency({
          orderCurrency: 'CAD',
          regionCode: 'CM',
          regionCurrency: 'XAF',
        }),
      ).toBe('XAF');
    });
  });

  describe('formatEmailMoney', () => {
    it('formate XAF sans décimales forcées CAD', () => {
      const s = formatEmailMoney(1000, 'XAF');
      expect(s).toMatch(/1[\s\u00a0]?000/);
      expect(s.toUpperCase()).toMatch(/XAF|FCFA|CFA/);
    });

    it('formate CAD avec décimales', () => {
      const s = formatEmailMoney(1000, 'CAD');
      expect(s).toMatch(/1[\s\u00a0]?000[,.]00|1000[,.]00/);
    });
  });
});
