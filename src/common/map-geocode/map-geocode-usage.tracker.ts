import { Injectable } from '@nestjs/common';
import type {
  MapGeocodeRuntimeUsageSnapshot,
  MapGeocodeUsageRecord,
} from './map-geocode-usage.types';

type Counter = { total: number; cacheHits: number; externalCalls: number };

@Injectable()
export class MapGeocodeUsageTracker {
  private readonly startedAt = new Date();
  private readonly totals: Counter = {
    total: 0,
    cacheHits: 0,
    externalCalls: 0,
  };
  private readonly byOperation = new Map<string, Counter>();
  private readonly byEngine = new Map<
    string,
    { cacheHits: number; externalCalls: number }
  >();
  private readonly byContext = new Map<string, number>();

  record(event: MapGeocodeUsageRecord): void {
    this.totals.total += 1;
    if (event.source === 'cache_hit') {
      this.totals.cacheHits += 1;
    } else {
      this.totals.externalCalls += 1;
    }

    const op = this.byOperation.get(event.operation) ?? {
      total: 0,
      cacheHits: 0,
      externalCalls: 0,
    };
    op.total += 1;
    if (event.source === 'cache_hit') op.cacheHits += 1;
    else op.externalCalls += 1;
    this.byOperation.set(event.operation, op);

    const engineKey = String(event.engine || 'unknown').trim().toLowerCase();
    const engine = this.byEngine.get(engineKey) ?? {
      cacheHits: 0,
      externalCalls: 0,
    };
    if (event.source === 'cache_hit') engine.cacheHits += 1;
    else engine.externalCalls += 1;
    this.byEngine.set(engineKey, engine);

    const contextKey = String(event.context ?? 'unknown').trim() || 'unknown';
    this.byContext.set(contextKey, (this.byContext.get(contextKey) ?? 0) + 1);
  }

  snapshot(): MapGeocodeRuntimeUsageSnapshot {
    const { total, cacheHits, externalCalls } = this.totals;
    const cacheHitRatePercent =
      total > 0 ? Math.round((cacheHits / total) * 10000) / 100 : 0;

    return {
      trackedSince: this.startedAt.toISOString(),
      requests: {
        total,
        cacheHits,
        externalCalls,
        cacheHitRatePercent,
      },
      byOperation: [...this.byOperation.entries()]
        .map(([operation, stats]) => ({
          operation: operation as MapGeocodeUsageRecord['operation'],
          ...stats,
        }))
        .sort((a, b) => b.total - a.total),
      byEngine: [...this.byEngine.entries()]
        .map(([engine, stats]) => ({ engine, ...stats }))
        .sort(
          (a, b) =>
            b.cacheHits +
            b.externalCalls -
            (a.cacheHits + a.externalCalls),
        ),
      byContext: [...this.byContext.entries()]
        .map(([context, count]) => ({ context, total: count }))
        .sort((a, b) => b.total - a.total),
    };
  }
}
