import {
  primaryTrafficEngineFromPool,
  trafficFactorFromSpeeds,
  trafficFleetCellKey,
  trafficPoolFromScalar,
  normalizeTrafficEnginePrimary,
  pickWeightedTrafficEngine,
  resolveTrafficPool,
  type TrafficEngineId,
  type TrafficEnginePrimary,
} from './traffic-engine-pool.util';

describe('traffic-engine-pool.util', () => {
  it('normalise primary none / fleet', () => {
    expect(normalizeTrafficEnginePrimary('none')).toBe('none');
    expect(normalizeTrafficEnginePrimary('own')).toBe('fleet');
    expect(normalizeTrafficEnginePrimary('tomtom')).toBe('tomtom');
  });

  it('pickWeightedTrafficEngine respecte les poids', () => {
    const picked = pickWeightedTrafficEngine(
      [
        { engine: 'fleet', weight: 100 },
        { engine: 'tomtom', weight: 0 },
      ],
      () => true,
      'none',
      () => 0.1,
    );
    expect(picked).toBe('fleet');
  });

  it('trafficFactorFromSpeeds', () => {
    expect(
      trafficFactorFromSpeeds({
        observedSpeedKmh: 20,
        freeFlowSpeedKmh: 40,
      }),
    ).toBe(2);
    expect(
      trafficFactorFromSpeeds({
        observedSpeedKmh: 40,
        freeFlowSpeedKmh: 40,
      }),
    ).toBe(1);
  });

  it('fleet cell key stable', () => {
    expect(trafficFleetCellKey(45.501, -73.567)).toBe(
      trafficFleetCellKey(45.5012, -73.5671),
    );
  });

  it('primary from pool', () => {
    expect(
      primaryTrafficEngineFromPool([
        { engine: 'mapbox', weight: 30 },
        { engine: 'tomtom', weight: 70 },
      ]),
    ).toBe('tomtom');
    expect(trafficPoolFromScalar('none')).toEqual([]);
    expect(resolveTrafficPool([], 'fleet')).toEqual([
      { engine: 'fleet', weight: 100 },
    ]);
  });
});
