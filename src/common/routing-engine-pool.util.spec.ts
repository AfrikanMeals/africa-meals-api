import {
  KNOWN_ROUTING_ENGINES,
  normalizeRoutingEngineId,
  normalizeRoutingEnginePool,
  primaryRoutingEngineFromPool,
  routingPoolFromScalar,
  type RoutingEngineId,
  type RoutingEnginePoolEntry,
} from './routing-engine-pool.util';

describe('routing-engine-pool.util', () => {
  it('normalizes engine aliases', () => {
    expect(normalizeRoutingEngineId('Mapbox Directions')).toBe('mapbox');
    expect(normalizeRoutingEngineId('google')).toBe('google_directions');
    expect(normalizeRoutingEngineId('google_routes_api')).toBe('google_routes');
    expect(normalizeRoutingEngineId('OSRM')).toBe('osrm');
    expect(normalizeRoutingEngineId('nope')).toBeNull();
  });

  it('builds pool and picks primary by weight', () => {
    const pool = normalizeRoutingEnginePool([
      { engine: 'osrm', weight: 20 },
      { engine: 'mapbox', weight: 80 },
      { engine: 'mapbox', weight: 10 },
    ]);
    expect(pool).toEqual([
      { engine: 'osrm', weight: 20 },
      { engine: 'mapbox', weight: 90 },
    ]);
    expect(primaryRoutingEngineFromPool(pool, 'osrm')).toBe('mapbox');
  });

  it('falls back to scalar pool when empty', () => {
    expect(routingPoolFromScalar('osrm')).toEqual([
      { engine: 'osrm', weight: 100 },
    ]);
  });

  it('lists known engines', () => {
    expect(KNOWN_ROUTING_ENGINES).toContain('osrm');
    expect(KNOWN_ROUTING_ENGINES).toContain('google_routes');
  });

  it('picks weighted engine among eligible', () => {
    const pool: RoutingEnginePoolEntry[] = [
      { engine: 'osrm', weight: 0 },
      { engine: 'mapbox', weight: 100 },
    ];
    const picked = primaryRoutingEngineFromPool(
      pool.filter((e) => e.weight > 0),
      'osrm' as RoutingEngineId,
    );
    expect(picked).toBe('mapbox');
  });
});
