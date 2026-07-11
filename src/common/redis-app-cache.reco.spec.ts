import {
  AppCacheKeys,
  parseCacheTtlMs,
  RECO_FEED_CACHE_PREFIX,
  recommendationsCacheTtlMs,
  setRuntimeCacheTtlOverrides,
} from './redis-app-cache';

describe('recommendations cache keys & TTL', () => {
  afterEach(() => {
    setRuntimeCacheTtlOverrides({});
  });

  it('builds recoFeed key with user scope first for prefix bust', () => {
    expect(AppCacheKeys.recoFeed('u123', 'CM', 24)).toBe(
      'reco:feed:v1:u123:CM:t24',
    );
    expect(AppCacheKeys.recoFeed('', 'xx', 0)).toBe('reco:feed:v1:anon:CA:t24');
    expect(AppCacheKeys.recoFeed('anon', 'CA', 12)).toBe(
      'reco:feed:v1:anon:CA:t12',
    );
    expect(RECO_FEED_CACHE_PREFIX).toBe('reco:feed:v1:');
  });

  it('defaults recommendations TTL to 45s and honors runtime override', () => {
    expect(recommendationsCacheTtlMs()).toBe(45_000);
    expect(parseCacheTtlMs(undefined, 45_000)).toBe(45_000);
    setRuntimeCacheTtlOverrides({ recommendationsTtlMs: 30_000 });
    expect(recommendationsCacheTtlMs()).toBe(30_000);
  });
});
