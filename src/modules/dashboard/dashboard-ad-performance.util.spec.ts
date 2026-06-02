import {
  buildDashboardAdPerformancePayload,
  computeAdPerformanceScore5,
} from './dashboard-ad-performance.util';

describe('computeAdPerformanceScore5', () => {
  it('retourne null si peu d’impressions', () => {
    expect(
      computeAdPerformanceScore5({
        impressions: 2,
        clicks: 1,
        conversions: 0,
      }),
    ).toBeNull();
  });

  it('note élevée pour bon CTR et conversions', () => {
    const score = computeAdPerformanceScore5({
      impressions: 1000,
      clicks: 80,
      conversions: 10,
    });
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThan(3.5);
    expect(score!).toBeLessThanOrEqual(5);
  });

  it('note basse pour faible engagement', () => {
    const score = computeAdPerformanceScore5({
      impressions: 500,
      clicks: 2,
      conversions: 0,
    });
    expect(score).not.toBeNull();
    expect(score!).toBeLessThan(2);
  });
});

describe('buildDashboardAdPerformancePayload', () => {
  it('calcule CTR et tendance', () => {
    const p = buildDashboardAdPerformancePayload({
      current: { impressions: 100, clicks: 10, conversions: 2 },
      previous: { impressions: 100, clicks: 5, conversions: 1 },
      activeBanners: 3,
      activeCampaigns: 1,
    });
    expect(p.ctrPercent).toBe(10);
    expect(p.conversionRatePercent).toBe(20);
    expect(p.score).not.toBeNull();
  });
});
