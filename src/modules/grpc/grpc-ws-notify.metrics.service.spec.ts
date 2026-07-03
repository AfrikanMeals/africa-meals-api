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

  it('exports idle counter series when no RPC yet', () => {
    const metrics = new GrpcWsNotifyMetricsService();
    const rendered = metrics.renderPrometheus('api', 'pod-a').join('\n');
    expect(rendered).toContain('api_grpc_client_requests_total');
    expect(rendered).toContain('method="__idle__"');
  });
});
