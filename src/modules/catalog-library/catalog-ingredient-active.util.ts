/**
 * Ingrédient bibliothèque : actif sauf `false` explicite.
 * Docs legacy sans champ `active` → considérés actifs.
 */
export function readCatalogIngredientActive(raw: unknown): boolean {
  if (raw === false || raw === 'false' || raw === 0 || raw === '0') {
    return false;
  }
  return true;
}
