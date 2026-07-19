import { readCatalogIngredientActive } from './catalog-ingredient-active.util';

describe('readCatalogIngredientActive', () => {
  it('traite false / 0 comme inactif', () => {
    expect(readCatalogIngredientActive(false)).toBe(false);
    expect(readCatalogIngredientActive('false')).toBe(false);
    expect(readCatalogIngredientActive(0)).toBe(false);
    expect(readCatalogIngredientActive('0')).toBe(false);
  });

  it('traite true / absent / autre comme actif (legacy)', () => {
    expect(readCatalogIngredientActive(true)).toBe(true);
    expect(readCatalogIngredientActive(undefined)).toBe(true);
    expect(readCatalogIngredientActive(null)).toBe(true);
    expect(readCatalogIngredientActive('')).toBe(true);
  });
});
