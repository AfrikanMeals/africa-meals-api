import {
  DEFAULT_ROUTING_CACHE_SETTINGS,
  normalizeRoutingCacheSettings,
  type RoutingCacheSettings,
} from './routing-cache-settings.util';

describe('routing-cache-settings.util', () => {
  it('returns cost-optimized defaults', () => {
    expect(normalizeRoutingCacheSettings(undefined)).toEqual(
      DEFAULT_ROUTING_CACHE_SETTINGS,
    );
    expect(DEFAULT_ROUTING_CACHE_SETTINGS.requestAlternatives).toBe(false);
    expect(DEFAULT_ROUTING_CACHE_SETTINGS.staticTtlSeconds).toBeGreaterThanOrEqual(
      600,
    );
  });

  it('clamps out-of-range values', () => {
    const normalized = normalizeRoutingCacheSettings({
      staticTtlSeconds: 5,
      dynamicTtlSeconds: 9999,
      agentMoveInvalidateMeters: 1,
      requestAlternatives: true,
      adminTtlMs: 1000,
      gpsMarkerDistanceFilterMeters: 100,
      routeRefreshDebounceMs: 10,
    });
    expect(normalized.staticTtlSeconds).toBe(60);
    expect(normalized.dynamicTtlSeconds).toBe(300);
    expect(normalized.agentMoveInvalidateMeters).toBe(25);
    expect(normalized.requestAlternatives).toBe(true);
    expect(normalized.adminTtlMs).toBe(30_000);
    expect(normalized.gpsMarkerDistanceFilterMeters).toBe(25);
    expect(normalized.routeRefreshDebounceMs).toBe(300);
  });

  it('keeps precise GPS marker filter by default', () => {
    expect(
      normalizeRoutingCacheSettings({}).gpsMarkerDistanceFilterMeters,
    ).toBe(5);
  });
});
