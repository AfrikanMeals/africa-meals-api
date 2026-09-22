import {
  acceptsOrdersForTradingOverride,
  normalizeTradingOverride,
  resolveStoreTradingOpen,
  storeNotTradingClosedMatch,
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
    it('défaut ouvert même si acceptsOrders false et hors horaires', () => {
      expect(
        resolveStoreTradingOpen({
          status: 'ACTIVE',
          acceptsOrders: false,
          tradingOverride: null,
          hoursClosed: true,
        }),
      ).toBe(true);
    });

    it('force fermé uniquement via override closed', () => {
      expect(
        resolveStoreTradingOpen({
          status: 'ACTIVE',
          acceptsOrders: true,
          tradingOverride: 'closed',
          hoursClosed: false,
        }),
      ).toBe(false);
    });

    it('override open → ouvert', () => {
      expect(
        resolveStoreTradingOpen({
          status: 'ACTIVE',
          acceptsOrders: false,
          tradingOverride: 'open',
          hoursClosed: true,
        }),
      ).toBe(true);
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

  describe('storeNotTradingClosedMatch', () => {
    it('exclut closed en camel + snake', () => {
      expect(storeNotTradingClosedMatch('store')).toEqual({
        $and: [
          { 'store.tradingOverride': { $ne: 'closed' } },
          { 'store.trading_override': { $ne: 'closed' } },
        ],
      });
    });
  });

  describe('acceptsOrdersForTradingOverride', () => {
    it('sync checkout', () => {
      expect(acceptsOrdersForTradingOverride('open')).toBe(true);
      expect(acceptsOrdersForTradingOverride('closed')).toBe(false);
    });
  });
});
