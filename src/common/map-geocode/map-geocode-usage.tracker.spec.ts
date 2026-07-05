import { MapGeocodeUsageTracker } from './map-geocode-usage.tracker';

describe('MapGeocodeUsageTracker', () => {
  it('accumulates cache hits and external calls', () => {
    const tracker = new MapGeocodeUsageTracker();

    tracker.record({
      operation: 'forward',
      engine: 'osm',
      source: 'cache_hit',
      context: 'mobileUser',
    });
    tracker.record({
      operation: 'forward',
      engine: 'osm',
      source: 'external',
      context: 'mobileUser',
    });
    tracker.record({
      operation: 'reverse',
      engine: 'mapbox',
      source: 'external',
      context: 'vendor',
    });

    const snapshot = tracker.snapshot();
    expect(snapshot.requests.total).toBe(3);
    expect(snapshot.requests.cacheHits).toBe(1);
    expect(snapshot.requests.externalCalls).toBe(2);
    expect(snapshot.requests.cacheHitRatePercent).toBeCloseTo(33.33, 1);
    expect(snapshot.byOperation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: 'forward', total: 2 }),
        expect.objectContaining({ operation: 'reverse', total: 1 }),
      ]),
    );
    expect(snapshot.byEngine).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ engine: 'osm', cacheHits: 1, externalCalls: 1 }),
        expect.objectContaining({ engine: 'mapbox', externalCalls: 1 }),
      ]),
    );
    expect(snapshot.byContext).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ context: 'mobileUser', total: 2 }),
        expect.objectContaining({ context: 'vendor', total: 1 }),
      ]),
    );
  });
});
