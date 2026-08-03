import {
  formatPayoutDisplayLabel,
  parsePlatformPayoutNumber,
  planMissingPayoutNumberAssignments,
  PLATFORM_PAYOUT_NUMBER_META_KEY,
} from './stripe-connect-payout-number.util';

describe('stripe-connect-payout-number.util', () => {
  describe('parsePlatformPayoutNumber', () => {
    it('lit un entier ≥ 1 depuis metadata', () => {
      expect(
        parsePlatformPayoutNumber({ [PLATFORM_PAYOUT_NUMBER_META_KEY]: '3' }),
      ).toBe(3);
    });

    it('rejette valeurs invalides', () => {
      expect(parsePlatformPayoutNumber({})).toBeNull();
      expect(
        parsePlatformPayoutNumber({ [PLATFORM_PAYOUT_NUMBER_META_KEY]: '0' }),
      ).toBeNull();
      expect(
        parsePlatformPayoutNumber({ [PLATFORM_PAYOUT_NUMBER_META_KEY]: '1.5' }),
      ).toBeNull();
      expect(
        parsePlatformPayoutNumber({ [PLATFORM_PAYOUT_NUMBER_META_KEY]: 'abc' }),
      ).toBeNull();
    });
  });

  describe('planMissingPayoutNumberAssignments', () => {
    it('attribue 1..N au plus ancien d’abord', () => {
      const plan = planMissingPayoutNumberAssignments([
        { id: 'po_new', created: 200, number: null },
        { id: 'po_old', created: 100, number: null },
      ]);
      expect(plan.assignments).toEqual([
        { id: 'po_old', number: 1 },
        { id: 'po_new', number: 2 },
      ]);
      expect(plan.nextNumber).toBe(3);
    });

    it('conserve les numéros existants et comble les trous', () => {
      const plan = planMissingPayoutNumberAssignments([
        { id: 'po_a', created: 100, number: null },
        { id: 'po_b', created: 150, number: 1 },
        { id: 'po_c', created: 200, number: null },
      ]);
      expect(plan.assignments).toEqual([
        { id: 'po_a', number: 2 },
        { id: 'po_c', number: 3 },
      ]);
      expect(plan.nextNumber).toBe(4);
    });
  });

  describe('formatPayoutDisplayLabel', () => {
    it('formate Payout #N', () => {
      expect(formatPayoutDisplayLabel(1)).toBe('Payout #1');
      expect(formatPayoutDisplayLabel(12)).toBe('Payout #12');
    });

    it('ne expose jamais po_… si numéro absent', () => {
      expect(formatPayoutDisplayLabel(null, 'po_abc')).toBe('Payout');
    });
  });
});
