import { Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  RequestStatsEntry,
  RequestStatsKind,
  RequestStatsQuery,
} from './request-stats.types';
import { applyRequestStatsFilters } from './request-stats-slow.util';
import { RequestStatsPrometheusAggregator } from './request-stats-prometheus.aggregator';

export type PushRequestStatsInput = Omit<
  RequestStatsEntry,
  'id' | 'at' | 'source'
> & {
  source?: 'api' | 'ws';
  responseBytes?: number;
  requestBytes?: number;
};

@Injectable()
export class RequestStatsStore {
  private entries: RequestStatsEntry[] = [];
  private maxEntries = 10_000;

  constructor(
    @Optional()
    private readonly prometheus?: RequestStatsPrometheusAggregator,
  ) {}

  configure(maxEntries: number): void {
    this.maxEntries = maxEntries;
    if (this.entries.length > maxEntries) {
      this.entries = this.entries.slice(-maxEntries);
    }
  }

  push(input: PushRequestStatsInput): void {
    const entry: RequestStatsEntry = {
      id: randomUUID(),
      at: new Date().toISOString(),
      source: input.source ?? 'api',
      kind: input.kind,
      method: input.method,
      route: input.route,
      storeId: input.storeId,
      statusCode: input.statusCode,
      durationMs: input.durationMs,
      userId: input.userId,
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    this.prometheus?.record({
      kind: input.kind,
      method: input.method,
      route: input.route,
      statusCode: input.statusCode,
      durationMs: input.durationMs,
      responseBytes: input.responseBytes,
      requestBytes: input.requestBytes,
    });
  }

  clear(): void {
    this.entries = [];
  }

  size(): number {
    return this.entries.length;
  }

  snapshot(): RequestStatsEntry[] {
    return [...this.entries];
  }

  query(q: RequestStatsQuery): RequestStatsEntry[] {
    let list = applyRequestStatsFilters(this.entries, q);
    const limit = Math.min(Math.max(q.limit ?? 200, 1), 500);
    const sortBy = q.sortBy ?? 'at';
    if (sortBy === 'duration') {
      list.sort((a, b) => b.durationMs - a.durationMs);
      return list.slice(0, limit);
    }
    return list.slice(-limit).reverse();
  }

  filtered(q: RequestStatsQuery): RequestStatsEntry[] {
    return applyRequestStatsFilters(this.entries, q);
  }

  summaryFor(list: RequestStatsEntry[]): {
    http: { count: number; avgMs: number };
    ws: { count: number; avgMs: number };
  } {
    const bucket = (kind: RequestStatsKind) => {
      const rows = list.filter((e) => e.kind === kind);
      const count = rows.length;
      const avgMs =
        count === 0
          ? 0
          : Math.round(rows.reduce((s, e) => s + e.durationMs, 0) / count);
      return { count, avgMs };
    };
    return { http: bucket('http'), ws: bucket('ws') };
  }
}
