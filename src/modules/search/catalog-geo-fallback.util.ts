/**
 * Fallback catalogue quand le filtre proximité ne renvoie aucun résultat.
 * La 1ʳᵉ passe (rayon) reste inchangée ; si vide + geo actif → découverte régionale.
 */

export type CatalogGeoDiscoveryFallbackInput = {
  /** GPS plausible pour la région catalogue (après strip hors-marché). */
  geoActive: boolean;
  /** Total après filtre rayon (0 → fallback). */
  nearbyTotal: number;
};

/** Active le repli « best sales / rated / visited » (région, hors rayon). */
export function shouldUseCatalogGeoDiscoveryFallback(
  input: CatalogGeoDiscoveryFallbackInput,
): boolean {
  return Boolean(input.geoActive) && Number(input.nearbyTotal ?? 0) <= 0;
}

/** Taille max du pool découverte (évite lookup orders sur tout le parc). */
export const CATALOG_GEO_DISCOVERY_CANDIDATE_LIMIT = 300;

/**
 * Score découverte (aligné reco trending stores) :
 * ventes × 2.2 + likes (visites/engagement) + note × 3.
 */
export function catalogDiscoveryRankScore(args: {
  orderCount: number;
  likeCount: number;
  averageRating: number;
}): number {
  const sales = Math.max(0, Number(args.orderCount) || 0);
  const likes = Math.max(0, Number(args.likeCount) || 0);
  const rating = Math.max(0, Number(args.averageRating) || 0);
  return sales * 2.2 + likes + rating * 3;
}
