import {
  DEFAULT_GEOCODE_CACHE_STORE_PRIORITY,
  normalizeGeocodeCacheStorePriority,
} from './geocode-cache-store.util';

describe('geocode-cache-store.util', () => {
  it('complète une liste partielle avec les stores manquants', () => {
    expect(normalizeGeocodeCacheStorePriority(['mongodb', 'redis'])).toEqual([
      'mongodb',
      'redis',
      'memcached',
    ]);
  });

  it('ignore les doublons et alias mongo/db', () => {
    expect(
      normalizeGeocodeCacheStorePriority(['db', 'redis', 'redis', 'memcached']),
    ).toEqual(['mongodb', 'redis', 'memcached']);
  });

  it('retourne le défaut si entrée vide', () => {
    expect(normalizeGeocodeCacheStorePriority(undefined)).toEqual(
      DEFAULT_GEOCODE_CACHE_STORE_PRIORITY,
    );
  });
});
