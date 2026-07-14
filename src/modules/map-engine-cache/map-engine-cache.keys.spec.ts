import {
  hashMapCacheParts,
  mapDistanceCacheKey,
  mapEtaCacheKey,
  mapMatrixCacheKey,
  mapRouteCacheKey,
  mapTrafficExtCacheKey,
  parseMapCacheTtlSec,
  roundCoordForCache,
} from './map-engine-cache.keys';

describe('map-engine-cache.keys', () => {
  it('arrondit et produit des clés stables matrice', () => {
    const a = mapMatrixCacheKey('osrm', [
      [11.5021, 3.8481],
      [11.51, 3.85],
    ]);
    const b = mapMatrixCacheKey('osrm', [
      [11.5024, 3.8484],
      [11.5102, 3.8501],
    ]);
    expect(a).toBe(b);
    expect(a).toContain('map:matrix:v1:osrm:');
  });

  it('différencie engines', () => {
    const coords: Array<[number, number]> = [
      [1, 2],
      [3, 4],
    ];
    expect(mapMatrixCacheKey('osrm', coords)).not.toBe(
      mapMatrixCacheKey('mapbox', coords),
    );
  });

  it('clés route / trafic / eta / distance', () => {
    expect(
      mapRouteCacheKey('osrm', { lat: 1, lng: 2 }, { lat: 3, lng: 4 }),
    ).toContain('map:route:v1:osrm:');
    expect(mapTrafficExtCacheKey('tomtom', 3.85, 11.5)).toContain(
      'map:traffic:ext:v1:tomtom:',
    );
    expect(mapEtaCacheKey(3.85, 11.5)).toContain('map:eta:v1:');
    expect(
      mapDistanceCacheKey('osrm', { lat: 1, lng: 2 }, { lat: 3, lng: 4 }),
    ).toContain('distance');
  });

  it('parseMapCacheTtlSec clamp', () => {
    expect(parseMapCacheTtlSec('matrix', '999999')).toBe(86_400);
    expect(parseMapCacheTtlSec('matrix', '1')).toBe(5);
    expect(parseMapCacheTtlSec('matrix', undefined)).toBe(120);
  });

  it('roundCoordForCache + hash', () => {
    expect(roundCoordForCache(3.8489, 3)).toBe(3.849);
    expect(hashMapCacheParts('a', 'b')).toHaveLength(20);
  });
});
