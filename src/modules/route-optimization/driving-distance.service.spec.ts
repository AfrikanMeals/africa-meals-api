import { DrivingDistanceService } from './driving-distance.service';
import type { RoutingMatrixService } from './routing-matrix.service';

describe('DrivingDistanceService', () => {
  const origin = { lat: 45.5017, lon: -73.5673 };
  const dest = { lat: 45.5088, lon: -73.554 };

  function stubMatrix(opts: {
    configured: string[];
    metersByEngine: Record<string, number | null>;
  }): RoutingMatrixService {
    return {
      isMatrixProviderConfigured: (engine: string) =>
        opts.configured.includes(engine),
      fetchOdDrivingDistanceMeters: async (
        _o: unknown,
        _d: unknown,
        engine: string,
      ) => opts.metersByEngine[engine] ?? null,
    } as unknown as RoutingMatrixService;
  }

  it('prefers Google driving meters over haversine (Gmaps-class gap)', async () => {
    const svc = new DrivingDistanceService(
      stubMatrix({
        configured: ['google_directions', 'osrm'],
        metersByEngine: { google_directions: 4600, osrm: 4100 },
      }),
    );
    const result = await svc.resolveBillableDistanceKm({ origin, dest });
    expect(result.source).toBe('driving_route');
    expect(result.engine).toBe('google_directions');
    expect(result.distanceKm).toBe(4.6);
  });

  it('falls back to haversine when every engine fails', async () => {
    const svc = new DrivingDistanceService(
      stubMatrix({
        configured: ['osrm'],
        metersByEngine: { osrm: null },
      }),
    );
    const result = await svc.resolveBillableDistanceKm({ origin, dest });
    expect(result.source).toBe('haversine_fallback');
    expect(result.engine).toBeNull();
    expect(result.distanceKm).toBeGreaterThan(0);
    expect(result.distanceKm).toBeLessThan(4);
  });

  it('does not cache-hit a haversine fallback on the next call', async () => {
    let googleCalls = 0;
    const matrix = {
      isMatrixProviderConfigured: (engine: string) =>
        engine === 'google_directions',
      fetchOdDrivingDistanceMeters: async () => {
        googleCalls += 1;
        return googleCalls === 1 ? null : 4600;
      },
    } as unknown as RoutingMatrixService;
    const cache = {
      getJson: async () => null,
      setJson: async () => undefined,
    };
    const svc = new DrivingDistanceService(
      matrix,
      cache as never,
    );
    const first = await svc.resolveBillableDistanceKm({ origin, dest });
    expect(first.source).toBe('haversine_fallback');
    const second = await svc.resolveBillableDistanceKm({ origin, dest });
    expect(second.source).toBe('driving_route');
    expect(second.distanceKm).toBe(4.6);
    expect(googleCalls).toBe(2);
  });
});
