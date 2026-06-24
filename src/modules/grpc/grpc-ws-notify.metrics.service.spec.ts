import { GrpcWsNotifyMetricsService } from './grpc-ws-notify.metrics.service';

describe('GrpcWsNotifyMetricsService', () => {
  it('tracks latency samples', () => {
    const metrics = new GrpcWsNotifyMetricsService();
    metrics.record(10, true, false);
    metrics.record(30, true, false);
    metrics.record(50, false, true);
    const snap = metrics.snapshot();
    expect(snap.count).toBe(3);
    expect(snap.fallbackRate).toBeCloseTo(1 / 3);
  });
});
