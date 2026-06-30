import { GrpcWsNotifyMetricsService } from './grpc-ws-notify.metrics.service';

describe('GrpcWsNotifyMetricsService', () => {
  it('tracks latency samples', () => {
    const metrics = new GrpcWsNotifyMetricsService();
    metrics.record('Ping', 10, true, false);
    metrics.record('Ping', 30, true, false);
    metrics.record('Ping', 50, false, true);
    const snap = metrics.snapshot();
    expect(snap.count).toBe(3);
    expect(snap.fallbackRate).toBeCloseTo(1 / 3);
  });
});
