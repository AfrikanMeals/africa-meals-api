import {
  computeDispatchCost,
  DEFAULT_DISPATCH_COST_WEIGHTS,
  resolveDispatchCostWeights,
} from './dispatch-cost.util';

describe('dispatch-cost.util', () => {
  it('préfère proche + charge légère', () => {
    const nearLight = computeDispatchCost({
      distanceMeters: 500,
      hasGps: true,
      activeOrderCount: 0,
      maxConcurrentOrders: 2,
    });
    const farBusy = computeDispatchCost({
      distanceMeters: 5000,
      hasGps: true,
      activeOrderCount: 1,
      maxConcurrentOrders: 2,
      routeRemainingSeconds: 1200,
      predictedDelayMinutes: 8,
    });
    expect(nearLight).toBeLessThan(farBusy);
  });

  it('sans GPS ≫ avec GPS', () => {
    const withGps = computeDispatchCost({
      distanceMeters: 2000,
      hasGps: true,
      activeOrderCount: 0,
      maxConcurrentOrders: 2,
    });
    const noGps = computeDispatchCost({
      distanceMeters: null,
      hasGps: false,
      activeOrderCount: 0,
      maxConcurrentOrders: 2,
    });
    expect(noGps).toBeGreaterThan(withGps + 1000);
  });

  it('resolve weights env', () => {
    const w = resolveDispatchCostWeights({
      DISPATCH_WEIGHT_DISTANCE_KM: '2',
    } as NodeJS.ProcessEnv);
    expect(w.distanceKm).toBe(2);
    expect(w.workload).toBe(DEFAULT_DISPATCH_COST_WEIGHTS.workload);
  });
});
