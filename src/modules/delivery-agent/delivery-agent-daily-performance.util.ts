/**
 * Helpers purs — snapshot journalier perf livreur (API).
 */

export function deliveryAgentPerformanceDayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function deliveryAgentPerformanceStartOfDay(now = new Date()): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start;
}

export type DeliveryAgentDailyPerformancePayload = {
  ordersShippedToday: number;
  averageRating: number | null;
  ratingCount: number;
  distanceKmToday?: number | null;
  dayKey: string;
  fromCache: boolean;
};

export function mergeDailyPerformanceShippedCount(
  cached: number | null | undefined,
  liveOrClient: number,
): number {
  const a = Math.max(0, Math.round(Number(cached ?? 0)));
  const b = Math.max(0, Math.round(Number(liveOrClient ?? 0)));
  return Math.max(a, b);
}
