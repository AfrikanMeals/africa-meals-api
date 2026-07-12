import { Injectable } from '@nestjs/common';
import { prometheusLine } from '@modules/request-stats/request-stats-prometheus.util';

/**
 * Métriques Neo4j Phase 0 — latence Cypher, lag sync, fallbacks reco.
 */
@Injectable()
export class GraphMetricsService {
  private readonly counters = new Map<string, number>();
  private lastSyncEnqueueAtMs = 0;
  private lastSyncProcessedAtMs = 0;

  recordCypher(opts: {
    op: string;
    ok: boolean;
    latencyMs: number;
  }): void {
    const status = opts.ok ? 'ok' : 'error';
    const op = (opts.op || 'query').slice(0, 64);
    this.inc('neo4j_cypher_total', { op, status });
    this.inc(
      'neo4j_cypher_duration_ms_sum',
      { op, status },
      Math.max(0, opts.latencyMs),
    );
    this.inc('neo4j_cypher_duration_ms_count', { op, status });
  }

  recordRecoFallback(reason: string): void {
    this.inc('neo4j_reco_fallback_total', {
      reason: (reason || 'unknown').slice(0, 48),
    });
  }

  recordRecoHit(): void {
    this.inc('neo4j_reco_hit_total', {});
  }

  markSyncEnqueued(): void {
    this.lastSyncEnqueueAtMs = Date.now();
    this.inc('neo4j_graph_sync_enqueued_total', {});
  }

  markSyncProcessed(): void {
    this.lastSyncProcessedAtMs = Date.now();
    this.inc('neo4j_graph_sync_processed_total', {});
  }

  /** Lag estimé enqueue → dernier process (ms), 0 si jamais. */
  syncLagMs(): number {
    if (!this.lastSyncEnqueueAtMs || !this.lastSyncProcessedAtMs) return 0;
    return Math.max(0, this.lastSyncEnqueueAtMs - this.lastSyncProcessedAtMs);
  }

  renderPrometheus(pod: string): string[] {
    const lines: string[] = [
      '# HELP neo4j_cypher_total Cypher queries by op/status',
      '# TYPE neo4j_cypher_total counter',
    ];
    this.appendCounterLines(lines, 'neo4j_cypher_total', pod);
    lines.push(
      '# HELP neo4j_cypher_duration_ms_sum Cypher latency sum ms',
      '# TYPE neo4j_cypher_duration_ms_sum counter',
    );
    this.appendCounterLines(lines, 'neo4j_cypher_duration_ms_sum', pod);
    lines.push(
      '# HELP neo4j_cypher_duration_ms_count Cypher latency sample count',
      '# TYPE neo4j_cypher_duration_ms_count counter',
    );
    this.appendCounterLines(lines, 'neo4j_cypher_duration_ms_count', pod);
    lines.push(
      '# HELP neo4j_reco_fallback_total RecommendationFacade fail-open to Mongo',
      '# TYPE neo4j_reco_fallback_total counter',
    );
    this.appendCounterLines(lines, 'neo4j_reco_fallback_total', pod);
    lines.push(
      '# HELP neo4j_reco_hit_total Successful Neo4j reco reads',
      '# TYPE neo4j_reco_hit_total counter',
    );
    this.appendCounterLines(lines, 'neo4j_reco_hit_total', pod);
    lines.push(
      '# HELP neo4j_graph_sync_enqueued_total Graph sync jobs enqueued',
      '# TYPE neo4j_graph_sync_enqueued_total counter',
    );
    this.appendCounterLines(lines, 'neo4j_graph_sync_enqueued_total', pod);
    lines.push(
      '# HELP neo4j_graph_sync_processed_total Graph sync jobs processed',
      '# TYPE neo4j_graph_sync_processed_total counter',
    );
    this.appendCounterLines(lines, 'neo4j_graph_sync_processed_total', pod);
    lines.push(
      '# HELP neo4j_graph_sync_lag_ms Estimated lag last enqueue vs last process',
      '# TYPE neo4j_graph_sync_lag_ms gauge',
      prometheusLine('neo4j_graph_sync_lag_ms', this.syncLagMs(), { pod }),
      '',
    );
    return lines;
  }

  private inc(
    name: string,
    labels: Record<string, string>,
    amount = 1,
  ): void {
    const key = `${name}\u0001${JSON.stringify(labels)}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + amount);
  }

  private appendCounterLines(
    lines: string[],
    name: string,
    pod: string,
  ): void {
    const prefix = `${name}\u0001`;
    for (const [key, value] of this.counters) {
      if (!key.startsWith(prefix)) continue;
      const labels = JSON.parse(key.slice(prefix.length)) as Record<
        string,
        string
      >;
      lines.push(prometheusLine(name, value, { ...labels, pod }));
    }
  }
}
