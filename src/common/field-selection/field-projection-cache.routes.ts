/** Routes GET éligibles au cache de réponses filtrées (préfixes de chemin). */
export const FIELD_PROJECTION_CACHE_ROUTE_PREFIXES = [
  '/search',
  '/products/',
  '/stores/',
  '/shop-home',
  '/announcements',
  '/supported-countries',
  '/product-categories',
  '/drinks',
] as const;

export function isFieldProjectionCacheRoute(path: string): boolean {
  const p = (path.split('?')[0] ?? path).toLowerCase();
  if (p.includes('/graphql') || p.includes('/internal/')) return false;
  if (p.includes('/cart') || p.includes('/checkout')) return false;
  return FIELD_PROJECTION_CACHE_ROUTE_PREFIXES.some(
    (prefix) => p === prefix || p.startsWith(prefix),
  );
}
