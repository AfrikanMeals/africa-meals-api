import {
  CATALOG_GEO_DISCOVERY_CANDIDATE_LIMIT,
  catalogDiscoveryRankScore,
  shouldUseCatalogGeoDiscoveryFallback,
} from './catalog-geo-fallback.util';

describe('shouldUseCatalogGeoDiscoveryFallback', () => {
  it('active le fallback si geo actif et 0 nearby', () => {
    expect(
      shouldUseCatalogGeoDiscoveryFallback({
        geoActive: true,
        nearbyTotal: 0,
      }),
    ).toBe(true);
  });

  it('ne fallback pas s’il y a des résultats proximité', () => {
    expect(
      shouldUseCatalogGeoDiscoveryFallback({
        geoActive: true,
        nearbyTotal: 3,
      }),
    ).toBe(false);
  });

  it('ne fallback pas sans geo', () => {
    expect(
      shouldUseCatalogGeoDiscoveryFallback({
        geoActive: false,
        nearbyTotal: 0,
      }),
    ).toBe(false);
  });
});

describe('catalogDiscoveryRankScore', () => {
  it('pondère ventes, likes et note', () => {
    expect(
      catalogDiscoveryRankScore({
        orderCount: 10,
        likeCount: 5,
        averageRating: 4,
      }),
    ).toBeCloseTo(10 * 2.2 + 5 + 4 * 3, 5);
  });

  it('borne les négatifs à 0', () => {
    expect(
      catalogDiscoveryRankScore({
        orderCount: -1,
        likeCount: -2,
        averageRating: -3,
      }),
    ).toBe(0);
  });
});

describe('CATALOG_GEO_DISCOVERY_CANDIDATE_LIMIT', () => {
  it('est un plafond positif', () => {
    expect(CATALOG_GEO_DISCOVERY_CANDIDATE_LIMIT).toBeGreaterThan(50);
  });
});
