import {
  buildStripeWebhookMetricsSnapshot,
  percentile,
} from './stripe-webhook-metrics.util';

describe('stripe-webhook-metrics.util', () => {
  it('percentile returns interpolated p95', () => {
    const sorted = [10, 20, 30, 40, 100];
    expect(percentile(sorted, 50)).toBe(30);
    expect(percentile(sorted, 95)).toBeGreaterThan(40);
    expect(percentile(sorted, 95)).toBeLessThanOrEqual(100);
  });

  it('buildStripeWebhookMetricsSnapshot aggregates samples', () => {
    const now = Date.now();
    const snap = buildStripeWebhookMetricsSnapshot([
      { durationMs: 12, eventType: 'checkout.session.completed', at: now },
      { durationMs: 48, eventType: 'payment_intent.succeeded', at: now + 1 },
      { durationMs: 120, eventType: 'account.updated', at: now + 2 },
    ]);
    expect(snap.count).toBe(3);
    expect(snap.minMs).toBe(12);
    expect(snap.maxMs).toBe(120);
    expect(snap.lastEventType).toBe('account.updated');
    expect(snap.p95Ms).toBeGreaterThanOrEqual(snap.p50Ms);
  });
});
