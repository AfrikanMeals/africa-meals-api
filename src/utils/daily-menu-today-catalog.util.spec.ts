import {
  applyDailyMenuAvailabilityToCatalogItems,
  buildDailyMenuTodayForCatalogItem,
  isDailyMenuCatalogRestricted,
} from './daily-menu-today-catalog.util';

const storeWithDrinks = {
  dailyMenuByWeekday: [
    {
      dayOfWeek: 1,
      drinkItems: [
        { drinkId: 'd1', stockUnlimited: true, stockRemaining: 0 },
        { drinkId: 'd2', stockUnlimited: false, stockRemaining: 0 },
      ],
      bundleItems: [{ bundleId: 'b1', stockUnlimited: true, stockRemaining: 0 }],
    },
  ],
};

describe('buildDailyMenuTodayForCatalogItem', () => {
  it('onMenu pour boisson listée', () => {
    const dm = buildDailyMenuTodayForCatalogItem(
      storeWithDrinks,
      'd1',
      'drink',
      new Date('2026-07-20T12:00:00Z'), // lundi UTC
      'UTC',
    );
    expect(dm.onMenu).toBe(true);
    expect(dm.soldOut).toBe(false);
  });

  it('soldOut si stock menu épuisé', () => {
    const dm = buildDailyMenuTodayForCatalogItem(
      storeWithDrinks,
      'd2',
      'drink',
      new Date('2026-07-20T12:00:00Z'),
      'UTC',
    );
    expect(dm.onMenu).toBe(true);
    expect(dm.soldOut).toBe(true);
  });

  it('hors liste → onMenu false', () => {
    const dm = buildDailyMenuTodayForCatalogItem(
      storeWithDrinks,
      'd99',
      'drink',
      new Date('2026-07-20T12:00:00Z'),
      'UTC',
    );
    expect(dm.onMenu).toBe(false);
  });
});

describe('applyDailyMenuAvailabilityToCatalogItems', () => {
  const items = [{ id: 'd1' }, { id: 'd2' }, { id: 'd99' }];

  it('filtre sold-out et hors menu quand drinkItems non vide', () => {
    const out = applyDailyMenuAvailabilityToCatalogItems(
      items,
      storeWithDrinks,
      'drink',
      new Date('2026-07-20T12:00:00Z'),
      'UTC',
    );
    expect(out.map((x) => x.id)).toEqual(['d1']);
    expect(out[0]?.dailyMenuToday?.onMenu).toBe(true);
  });

  it('pas de restriction si drinkItems vide ce jour', () => {
    const emptyDay = {
      dailyMenuByWeekday: [{ dayOfWeek: 1, drinkItems: [], items: [] }],
    };
    const out = applyDailyMenuAvailabilityToCatalogItems(
      items,
      emptyDay,
      'drink',
      new Date('2026-07-20T12:00:00Z'),
      'UTC',
    );
    expect(out.map((x) => x.id)).toEqual(['d1', 'd2', 'd99']);
    expect(out.every((x) => x.dailyMenuToday == null)).toBe(true);
  });

  it('filtre bundles du jour', () => {
    const bundles = [{ id: 'b1' }, { id: 'b2' }];
    const out = applyDailyMenuAvailabilityToCatalogItems(
      bundles,
      storeWithDrinks,
      'bundle',
      new Date('2026-07-20T12:00:00Z'),
      'UTC',
    );
    expect(out.map((x) => x.id)).toEqual(['b1']);
  });
});

describe('isDailyMenuCatalogRestricted', () => {
  it('true si liste non vide', () => {
    expect(
      isDailyMenuCatalogRestricted(
        storeWithDrinks,
        'drink',
        new Date('2026-07-20T12:00:00Z'),
        'UTC',
      ),
    ).toBe(true);
  });

  it('false si pas de slot', () => {
    expect(
      isDailyMenuCatalogRestricted(
        { dailyMenuByWeekday: [] },
        'bundle',
        new Date('2026-07-20T12:00:00Z'),
        'UTC',
      ),
    ).toBe(false);
  });
});
