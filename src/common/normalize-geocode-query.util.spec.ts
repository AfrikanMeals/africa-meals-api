import {
  buildGeocodeCacheKey,
  normalizeGeocodeQuery,
} from './normalize-geocode-query.util';

describe('normalize-geocode-query.util', () => {
  it('normalise espaces et casse', () => {
    expect(normalizeGeocodeQuery('  123  Main   ST  ')).toBe(
      '123 main street',
    );
  });

  it('développe les abréviations courantes', () => {
    expect(normalizeGeocodeQuery('742 Evergreen Terr, Apt 5')).toBe(
      '742 evergreen terr apartment 5',
    );
  });

  it('construit une clé de cache stable', () => {
    const a = buildGeocodeCacheKey({
      kind: 'forward',
      query: '123 Main St',
      countryCode: 'ca',
      limit: 5,
      proximity: '-79.3800,43.6500',
      bbox: '-141,41,-52,83',
    });
    const b = buildGeocodeCacheKey({
      kind: 'forward',
      query: '123 MAIN  ST.',
      countryCode: 'CA',
      limit: 5,
      proximity: '-79.3800,43.6500',
      bbox: '-141,41,-52,83',
    });
    expect(a).toBe(b);
  });
});
