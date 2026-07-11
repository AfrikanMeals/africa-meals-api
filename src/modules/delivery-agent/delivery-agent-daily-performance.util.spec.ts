import {
  deliveryAgentPerformanceDayKey,
  mergeDailyPerformanceShippedCount,
} from './delivery-agent-daily-performance.util';

describe('deliveryAgentPerformanceDayKey', () => {
  it('formate YYYY-MM-DD', () => {
    expect(deliveryAgentPerformanceDayKey(new Date(2026, 6, 12, 15, 30))).toBe(
      '2026-07-12',
    );
  });
});

describe('mergeDailyPerformanceShippedCount', () => {
  it('prend le max cache / live', () => {
    expect(mergeDailyPerformanceShippedCount(2, 5)).toBe(5);
    expect(mergeDailyPerformanceShippedCount(7, 3)).toBe(7);
    expect(mergeDailyPerformanceShippedCount(null, 1)).toBe(1);
  });
});
