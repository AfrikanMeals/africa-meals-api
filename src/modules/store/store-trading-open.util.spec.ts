import {
  endOfStoreLocalDayUtc,
  isWithinStoreWorkingHours,
  storeHasFixedWorkingHours,
} from './store-working-hours.util';
import {
  acceptsOrdersForTradingOverride,
  normalizeTradingOverride,
  resolveStoreTradingOpen,
  resolveTradingFieldsForAdminPatch,
} from './store-trading-open.util';

const hours11to14 = {
  enabled: true,
  schedule: [
    {
      dayOfWeek: 0,
      closed: false,
      open24h: false,
      slots: [{ open: '11:00', close: '14:00' }],
    },
  ],
};

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
    const at10 = new Date('2026-09-27T10:00:00.000Z');
    const at12 = new Date('2026-09-27T12:00:00.000Z');
    const untilTonight = new Date('2026-09-28T00:00:00.000Z');
    const untilYesterday = new Date('2026-09-27T00:00:00.000Z');

    it('verrou acceptsOrders false ferme même dans le créneau', () => {
      expect(
        resolveStoreTradingOpen({
          status: 'ACTIVE',
          acceptsOrders: false,
          hasFixedHours: true,
          hoursOpen: true,
          now: at12,
        }),
      ).toBe(false);
    });

    it('horaires 11h–14h à 10h UTC → fermé', () => {
      expect(isWithinStoreWorkingHours(hours11to14, at10, 'UTC')).toBe(false);
      expect(
        resolveStoreTradingOpen({
          status: 'ACTIVE',
          acceptsOrders: true,
          hasFixedHours: true,
          hoursOpen: false,
          now: at10,
        }),
      ).toBe(false);
    });

    it('override open avant until → ouvert hors créneau', () => {
      expect(
        resolveStoreTradingOpen({
          status: 'ACTIVE',
          acceptsOrders: true,
          tradingOverride: 'open',
          tradingOverrideUntil: untilTonight,
          hasFixedHours: true,
          hoursOpen: false,
          now: at10,
        }),
      ).toBe(true);
    });

    it('until dépassé → retour aux horaires', () => {
      expect(
        resolveStoreTradingOpen({
          status: 'ACTIVE',
          acceptsOrders: true,
          tradingOverride: 'open',
          tradingOverrideUntil: untilYesterday,
          hasFixedHours: true,
          hoursOpen: false,
          now: at10,
        }),
      ).toBe(false);
    });

    it('sans horaires, closed reste fermé (pas d’expiration)', () => {
      expect(
        resolveStoreTradingOpen({
          status: 'ACTIVE',
          acceptsOrders: true,
          tradingOverride: 'closed',
          hasFixedHours: false,
          now: new Date('2026-09-28T12:00:00.000Z'),
        }),
      ).toBe(false);
    });

    it('sans horaires et sans override → ouvert', () => {
      expect(
        resolveStoreTradingOpen({
          status: 'ACTIVE',
          acceptsOrders: true,
          hasFixedHours: false,
        }),
      ).toBe(true);
    });

    it('override open sans until n’écrase pas les horaires', () => {
      expect(
        resolveStoreTradingOpen({
          status: 'ACTIVE',
          acceptsOrders: true,
          tradingOverride: 'open',
          hasFixedHours: true,
          hoursOpen: false,
          now: at10,
        }),
      ).toBe(false);
    });

    it('INACTIVE reste fermé même avec override open', () => {
      expect(
        resolveStoreTradingOpen({
          status: 'INACTIVE',
          acceptsOrders: true,
          tradingOverride: 'open',
          tradingOverrideUntil: untilTonight,
          hasFixedHours: true,
          hoursOpen: true,
        }),
      ).toBe(false);
    });
  });

  describe('endOfStoreLocalDayUtc', () => {
    it('pointe le jour civil suivant en UTC', () => {
      const end = endOfStoreLocalDayUtc(
        new Date('2026-09-27T10:00:00.000Z'),
        'UTC',
      );
      expect(end.toISOString()).toBe('2026-09-28T00:00:00.000Z');
    });
  });

  describe('storeHasFixedWorkingHours', () => {
    it('refuse un planning vide ou désactivé', () => {
      expect(storeHasFixedWorkingHours(undefined)).toBe(false);
      expect(
        storeHasFixedWorkingHours({ enabled: false, schedule: hours11to14.schedule }),
      ).toBe(false);
    });

    it('accepte un créneau', () => {
      expect(storeHasFixedWorkingHours(hours11to14)).toBe(true);
    });
  });

  describe('acceptsOrdersForTradingOverride', () => {
    it('sync checkout', () => {
      expect(acceptsOrdersForTradingOverride('open')).toBe(true);
      expect(acceptsOrdersForTradingOverride('closed')).toBe(false);
    });
  });

  describe('resolveTradingFieldsForAdminPatch', () => {
    it('ne couple plus closed avec acceptsOrders', () => {
      expect(
        resolveTradingFieldsForAdminPatch({
          tradingOverride: 'closed',
          acceptsOrders: true,
        }),
      ).toEqual({ tradingOverride: 'closed', acceptsOrders: true });
    });

    it('checkbox false reste un verrou sans forcer l’override', () => {
      expect(
        resolveTradingFieldsForAdminPatch({ acceptsOrders: false }),
      ).toEqual({ tradingOverride: null, acceptsOrders: false });
    });

    it('défaut acceptsOrders ouvert sans inventer un override', () => {
      expect(resolveTradingFieldsForAdminPatch({})).toEqual({
        tradingOverride: null,
        acceptsOrders: true,
      });
    });
  });
});
