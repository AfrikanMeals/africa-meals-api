import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  RequestStatsEntry,
  RequestStatsKind,
  RequestStatsQuery,
} from './request-stats.types';

export type PushRequestStatsInput = Omit<
  RequestStatsEntry,
  'id' | 'at' | 'source'
> & { source?: 'api' | 'ws' };

@Injectable()
export class RequestStatsStore {
  private entries: RequestStatsEntry[] = [];
  private maxEntries = 10_000;

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
  }

  clear(): void {
    this.entries = [];
  }

  size(): number {
    return this.entries.length;
  }

  query(q: RequestStatsQuery): RequestStatsEntry[] {
    let list = [...this.entries];
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
    const limit = Math.min(Math.max(q.limit ?? 200, 1), 500);
    return list.slice(-limit).reverse();
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
