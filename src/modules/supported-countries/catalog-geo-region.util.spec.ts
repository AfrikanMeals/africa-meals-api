import {
  haversineKm,
  isGeoPlausibleForCatalogRegion,
} from './catalog-geo-region.util';

describe('catalog-geo-region.util', () => {
  it('accepts coords near Cameroon for CM catalog', () => {
    expect(isGeoPlausibleForCatalogRegion(3.86, 11.51, 'CM')).toBe(true);
  });

  it('rejects Montreal coords for CM catalog', () => {
    expect(isGeoPlausibleForCatalogRegion(45.5, -73.5, 'CM')).toBe(false);
  });

  it('haversineKm returns positive distance', () => {
    expect(haversineKm(0, 0, 1, 1)).toBeGreaterThan(0);
  });
});
