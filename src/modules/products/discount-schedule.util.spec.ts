import {
  normalizeDiscountSchedules,
  pickActiveDiscountSchedule,
  resolveEffectiveDiscountPricing,
  resolvePromoUnitPrice,
} from './discount-schedule.util';

describe('discount-schedule.util', () => {
  const windowA = {
    label: 'A',
    startAt: '2026-06-01T08:00:00.000Z',
    endAt: '2026-06-10T08:00:00.000Z',
    price: 10,
    discountPrice: 8,
  };
  const windowB = {
    label: 'B',
    startAt: '2026-06-05T08:00:00.000Z',
    endAt: '2026-06-15T08:00:00.000Z',
    price: 12,
    discountPrice: 9,
  };

  describe('normalizeDiscountSchedules', () => {
    it('trie et normalise les fenêtres', () => {
      const rows = normalizeDiscountSchedules([windowB, windowA]);
      expect(rows).toHaveLength(2);
      expect(rows[0].label).toBe('A');
      expect(rows[1].discountPrice).toBe(9);
    });

    it('refuse une promo >= prix', () => {
      expect(() =>
        normalizeDiscountSchedules([
          { ...windowA, discountPrice: 10 },
        ]),
      ).toThrow('invalid_discount_schedule_promo');
    });

    it('refuse une plage invalide', () => {
      expect(() =>
        normalizeDiscountSchedules([
          {
            ...windowA,
            startAt: '2026-06-10T08:00:00.000Z',
            endAt: '2026-06-01T08:00:00.000Z',
          },
        ]),
      ).toThrow('invalid_discount_schedule_range');
    });
  });

  describe('pickActiveDiscountSchedule', () => {
    it('choisit la fenêtre au startAt le plus récent', () => {
      const schedules = normalizeDiscountSchedules([windowA, windowB]);
      const active = pickActiveDiscountSchedule(
        schedules,
        new Date('2026-06-06T12:00:00.000Z'),
      );
      expect(active?.label).toBe('B');
    });

    it('retourne null hors fenêtre', () => {
      const schedules = normalizeDiscountSchedules([windowA]);
      expect(
        pickActiveDiscountSchedule(
          schedules,
          new Date('2026-07-01T00:00:00.000Z'),
        ),
      ).toBeNull();
    });
  });

  describe('resolveEffectiveDiscountPricing', () => {
    it('applique la fenêtre active (clé priceCad côté boisson)', () => {
      const pricing = resolveEffectiveDiscountPricing({
        listPrice: 5,
        listDiscountPrice: 0,
        schedulesRaw: [windowA],
        now: new Date('2026-06-02T00:00:00.000Z'),
      });
      expect(pricing).toEqual({ price: 10, discountPrice: 8 });
    });

    it('restaure les baselines hors fenêtre', () => {
      const pricing = resolveEffectiveDiscountPricing({
        listPrice: 5,
        listDiscountPrice: 4,
        schedulesRaw: [windowA],
        now: new Date('2026-07-01T00:00:00.000Z'),
      });
      expect(pricing).toEqual({ price: 5, discountPrice: 4 });
    });
  });

  describe('resolvePromoUnitPrice', () => {
    it('prend la promo si valide', () => {
      expect(resolvePromoUnitPrice(10, 8)).toBe(8);
      expect(resolvePromoUnitPrice(10, 0)).toBe(10);
      expect(resolvePromoUnitPrice(10, 12)).toBe(10);
    });
  });
});
