import {
  regionAvailabilityZoneId,
  trafficCellId,
  trafficFactorFromAvgSpeedKmh,
} from './graph-map-cell.util';

describe('graph-map-cell.util', () => {
  it('regionAvailabilityZoneId', () => {
    expect(regionAvailabilityZoneId('cm')).toBe('region:CM');
    expect(regionAvailabilityZoneId('')).toBe('region:GLOBAL');
  });

  it('trafficCellId grille 0.01°', () => {
    expect(trafficCellId(3.848, 11.502)).toBe('tcell:385_1150');
  });

  it('trafficFactorFromAvgSpeedKmh ralentit si lent', () => {
    expect(trafficFactorFromAvgSpeedKmh(40)).toBeLessThanOrEqual(1.05);
    expect(trafficFactorFromAvgSpeedKmh(10)).toBeGreaterThan(1.2);
  });
});
