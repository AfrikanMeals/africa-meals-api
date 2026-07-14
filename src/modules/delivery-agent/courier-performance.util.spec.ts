import {
  acceptanceDispatchPenalty,
  computeCourierAcceptanceRate,
  computeCourierPerformanceScore,
  deriveCourierPerformance,
  performanceDispatchPenalty,
} from './courier-performance.util';

describe('courier-performance.util', () => {
  it('acceptanceRate null without samples', () => {
    expect(computeCourierAcceptanceRate({})).toBeNull();
  });

  it('acceptanceRate counts offers + marketplace', () => {
    expect(
      computeCourierAcceptanceRate({
        offersAccepted: 2,
        offersRejected: 1,
        offersExpired: 1,
        marketplaceClaims: 2,
        marketplaceMissed: 0,
      }),
    ).toBe(0.667);
  });

  it('performanceScore defaults to 70 for new courier', () => {
    expect(computeCourierPerformanceScore({})).toBe(70);
  });

  it('performanceScore rises with acceptance and completions', () => {
    const score = computeCourierPerformanceScore({
      offersAccepted: 8,
      offersRejected: 1,
      offersExpired: 1,
      completedDeliveries: 10,
      unassignByCourier: 0,
    });
    expect(score).toBeGreaterThan(70);
  });

  it('performanceScore drops with abandons', () => {
    const good = computeCourierPerformanceScore({
      offersAccepted: 5,
      offersRejected: 0,
      completedDeliveries: 5,
      unassignByCourier: 0,
    });
    const bad = computeCourierPerformanceScore({
      offersAccepted: 5,
      offersRejected: 0,
      completedDeliveries: 5,
      unassignByCourier: 5,
    });
    expect(bad).toBeLessThan(good);
  });

  it('deriveCourierPerformance averages duration and distance', () => {
    const d = deriveCourierPerformance({
      offersAccepted: 1,
      completedDeliveries: 2,
      totalDeliveryDurationSec: 3600,
      totalDistanceKm: 10,
    });
    expect(d.avgDeliveryDurationSec).toBe(1800);
    expect(d.avgDistanceKm).toBe(5);
    expect(d.performanceScore).toBeGreaterThan(0);
  });

  it('dispatch penalties scale with weak metrics', () => {
    expect(performanceDispatchPenalty(100)).toBe(0);
    expect(performanceDispatchPenalty(0)).toBe(25);
    expect(acceptanceDispatchPenalty(1)).toBe(0);
    expect(acceptanceDispatchPenalty(0)).toBe(20);
    expect(acceptanceDispatchPenalty(null)).toBe(0);
  });
});
