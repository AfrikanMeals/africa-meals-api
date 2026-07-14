import {
  FOOD_DELIVERY_DEFAULT_ROUTING_POOL,
  KNOWN_ROUTING_ENGINES,
  normalizeRoutingEngineId,
  normalizeRoutingEnginePool,
  pickPrimaryRoutingEngine,
  primaryRoutingEngineFromPool,
  resolveRoutingPool,
  routingEngineTryOrder,
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
    expect(normalizeRoutingEngineId('valhalla')).toBe('valhalla');
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

  it('food delivery empty pool → OSRM-dominant defaults', () => {
    expect(resolveRoutingPool([], 'mapbox', { foodDelivery: true })).toEqual(
      FOOD_DELIVERY_DEFAULT_ROUTING_POOL,
    );
    expect(FOOD_DELIVERY_DEFAULT_ROUTING_POOL[0]?.engine).toBe('osrm');
    expect(
      primaryRoutingEngineFromPool(
        FOOD_DELIVERY_DEFAULT_ROUTING_POOL,
        'mapbox',
      ),
    ).toBe('osrm');
  });

  it('falls back to scalar pool when empty (non food)', () => {
    expect(routingPoolFromScalar('osrm')).toEqual([
      { engine: 'osrm', weight: 100 },
    ]);
  });

  it('lists known engines including valhalla', () => {
    expect(KNOWN_ROUTING_ENGINES).toContain('osrm');
    expect(KNOWN_ROUTING_ENGINES).toContain('valhalla');
    expect(KNOWN_ROUTING_ENGINES).toContain('google_routes');
  });

  it('pickPrimary prefers OSRM when eligible and heaviest', () => {
    const pool: RoutingEnginePoolEntry[] = [
      { engine: 'osrm', weight: 70 },
      { engine: 'mapbox', weight: 20 },
    ];
    expect(
      pickPrimaryRoutingEngine(pool, () => true, 'mapbox' as RoutingEngineId),
    ).toBe('osrm');
  });

  it('try order puts OSRM then Valhalla in cascade', () => {
    const order = routingEngineTryOrder('mapbox');
    expect(order[0]).toBe('mapbox');
    expect(order[1]).toBe('osrm');
    expect(order[2]).toBe('valhalla');
  });
});
