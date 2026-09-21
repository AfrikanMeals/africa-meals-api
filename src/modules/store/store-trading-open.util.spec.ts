import {
  acceptsOrdersForTradingOverride,
  normalizeTradingOverride,
  resolveStoreTradingOpen,
} from './store-trading-open.util';

describe('store-trading-open.util', () => {
  describe('normalizeTradingOverride', () => {
    it('accepte open / closed (case-insensitive)', () => {
      expect(normalizeTradingOverride('open')).toBe('open');
      expect(normalizeTradingOverride('CLOSED')).toBe('closed');
    });

    it('retourne null pour vide / inconnu', () => {
      expect(normalizeTradingOverride(null)).toBeNull();
      expect(normalizeTradingOverride('')).toBeNull();
      expect(normalizeTradingOverride('auto')).toBeNull();
    });
  });

  describe('resolveStoreTradingOpen', () => {
    it('force ouvert même hors horaires', () => {
      expect(
        resolveStoreTradingOpen({
          status: 'ACTIVE',
          acceptsOrders: false,
          tradingOverride: 'open',
          hoursClosed: true,
        }),
      ).toBe(true);
    });

    it('force fermé même dans les horaires', () => {
      expect(
        resolveStoreTradingOpen({
          status: 'ACTIVE',
          acceptsOrders: true,
          tradingOverride: 'closed',
          hoursClosed: false,
        }),
      ).toBe(false);
    });

    it('sans override : respecte acceptsOrders + horaires', () => {
      expect(
        resolveStoreTradingOpen({
          status: 'ACTIVE',
          acceptsOrders: true,
          tradingOverride: null,
          hoursClosed: true,
        }),
      ).toBe(false);
      expect(
        resolveStoreTradingOpen({
          status: 'ACTIVE',
          acceptsOrders: true,
          tradingOverride: null,
          hoursClosed: false,
        }),
      ).toBe(true);
      expect(
        resolveStoreTradingOpen({
          status: 'ACTIVE',
          acceptsOrders: false,
          tradingOverride: null,
          hoursClosed: false,
        }),
      ).toBe(false);
    });

    it('INACTIVE reste fermé même avec override open', () => {
      expect(
        resolveStoreTradingOpen({
          status: 'INACTIVE',
          acceptsOrders: true,
          tradingOverride: 'open',
          hoursClosed: false,
        }),
      ).toBe(false);
    });
  });

  describe('acceptsOrdersForTradingOverride', () => {
    it('sync checkout', () => {
      expect(acceptsOrdersForTradingOverride('open')).toBe(true);
      expect(acceptsOrdersForTradingOverride('closed')).toBe(false);
    });
  });
});
