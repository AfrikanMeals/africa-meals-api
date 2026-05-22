import { storeHasDailyMenuForWeekday } from './daily-menu-defined.util';

describe('storeHasDailyMenuForWeekday', () => {
  it('returns false when empty', () => {
    expect(storeHasDailyMenuForWeekday([], 1)).toBe(false);
    expect(storeHasDailyMenuForWeekday(undefined, 1)).toBe(false);
  });

  it('returns true when slot has items', () => {
    expect(
      storeHasDailyMenuForWeekday(
        [{ dayOfWeek: 1, items: [{ productId: 'abc' }] }],
        1,
      ),
    ).toBe(true);
  });

  it('returns false when slot missing for day', () => {
    expect(
      storeHasDailyMenuForWeekday(
        [{ dayOfWeek: 2, items: [{ productId: 'abc' }] }],
        1,
      ),
    ).toBe(false);
  });

  it('supports legacy productIds', () => {
    expect(
      storeHasDailyMenuForWeekday([{ dayOfWeek: 0, productIds: ['x'] }], 0),
    ).toBe(true);
  });
});
