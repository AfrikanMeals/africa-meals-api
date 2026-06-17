export type StripeWebhookMetricsSnapshot = {
  count: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  lastMs: number | null;
  lastEventType: string | null;
  lastAt: string | null;
};

export function percentile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const rank = (p / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo]!;
  const weight = rank - lo;
  return sortedAsc[lo]! * (1 - weight) + sortedAsc[hi]! * weight;
}

export function buildStripeWebhookMetricsSnapshot(
  samples: ReadonlyArray<{ durationMs: number; eventType: string; at: number }>,
): StripeWebhookMetricsSnapshot {
  if (!samples.length) {
    return {
      count: 0,
      minMs: 0,
      maxMs: 0,
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      lastMs: null,
      lastEventType: null,
      lastAt: null,
    };
  }

  const durations = samples.map((s) => s.durationMs);
  const sorted = [...durations].sort((a, b) => a - b);
  const sum = durations.reduce((acc, n) => acc + n, 0);
  const last = samples[samples.length - 1]!;

  return {
    count: samples.length,
    minMs: sorted[0]!,
    maxMs: sorted[sorted.length - 1]!,
    avgMs: Math.round((sum / samples.length) * 10) / 10,
    p50Ms: Math.round(percentile(sorted, 50) * 10) / 10,
    p95Ms: Math.round(percentile(sorted, 95) * 10) / 10,
    lastMs: last.durationMs,
    lastEventType: last.eventType,
    lastAt: new Date(last.at).toISOString(),
  };
}
