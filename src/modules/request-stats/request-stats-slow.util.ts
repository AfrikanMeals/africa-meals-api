import {
  RequestStatsEntry,
  RequestStatsQuery,
  RequestStatsSlowInsights,
} from './request-stats.types';

export const DEFAULT_SLOW_THRESHOLD_MS = 2000;

export function applyRequestStatsFilters(
  entries: RequestStatsEntry[],
  q: RequestStatsQuery,
): RequestStatsEntry[] {
  let list = [...entries];
  const storeId = q.storeId?.trim();
  if (storeId) {
    list = list.filter((e) => e.storeId === storeId);
  }
  const kind = q.kind ?? 'all';
  if (kind !== 'all') {
    list = list.filter((e) => e.kind === kind);
  }
  const method = q.method?.trim().toUpperCase();
  if (method) {
    list = list.filter((e) => e.method.toUpperCase() === method);
  }
  const routeContains = q.routeContains?.trim().toLowerCase();
  if (routeContains) {
    list = list.filter((e) => e.route.toLowerCase().includes(routeContains));
  }
  const minDurationMs = q.minDurationMs;
  if (minDurationMs != null && minDurationMs > 0) {
    list = list.filter((e) => e.durationMs >= minDurationMs);
  }
  return list;
}

function percentileMs(values: number[], pct: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1),
  );
  return sorted[idx] ?? 0;
}

export function buildSlowInsights(
  scoped: RequestStatsEntry[],
  thresholdMs = DEFAULT_SLOW_THRESHOLD_MS,
  serviceSource: 'api' | 'ws' = 'api',
): RequestStatsSlowInsights {
  const slow = scoped.filter((e) => e.durationMs >= thresholdMs);
  const durations = slow.map((e) => e.durationMs);
  const routeMap = new Map<
    string,
    { route: string; method: string; count: number; totalMs: number; maxMs: number }
  >();
  for (const row of slow) {
    const key = `${row.method}\0${row.route}`;
    const cur = routeMap.get(key) ?? {
      route: row.route,
      method: row.method,
      count: 0,
      totalMs: 0,
      maxMs: 0,
    };
    cur.count += 1;
    cur.totalMs += row.durationMs;
    cur.maxMs = Math.max(cur.maxMs, row.durationMs);
    routeMap.set(key, cur);
  }
  const byRoute = [...routeMap.values()]
    .map((r) => ({
      route: r.route,
      method: r.method,
      count: r.count,
      avgMs: Math.round(r.totalMs / r.count),
      maxMs: r.maxMs,
    }))
    .sort((a, b) => b.maxMs - a.maxMs || b.count - a.count)
    .slice(0, 12);

  return {
    thresholdMs,
    slowCount: slow.length,
    totalInScope: scoped.length,
    slowRatePct:
      scoped.length === 0
        ? 0
        : Math.round((slow.length / scoped.length) * 1000) / 10,
    maxMs: durations.length ? Math.max(...durations) : 0,
    p95Ms: percentileMs(durations, 95),
    avgSlowMs: durations.length
      ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length)
      : 0,
    bySource: {
      api: serviceSource === 'api' ? slow.length : 0,
      ws: serviceSource === 'ws' ? slow.length : 0,
    },
    byRoute,
  };
}
