import { Injectable } from '@nestjs/common';
import { prometheusLine } from '@modules/request-stats/request-stats-prometheus.util';

type RpcSample = {
  latencyMs: number;
  ok: boolean;
  fallback: boolean;
  bytes: number;
  atMs: number;
};

@Injectable()
export class GrpcWsNotifyMetricsService {
  private readonly samples: RpcSample[] = [];
  private readonly maxSamples = 500;
  private readonly counters = new Map<string, number>();

  record(
    method: string,
    latencyMs: number,
    ok: boolean,
    fallback = false,
    bytes = 0,
  ): void {
    this.samples.push({
      latencyMs,
      ok,
      fallback,
      bytes: Math.max(0, bytes),
      atMs: Date.now(),
    });
    if (this.samples.length > this.maxSamples) {
      this.samples.splice(0, this.samples.length - this.maxSamples);
    }
    const normalized = method.trim() || 'unknown';
    const status = ok ? 'ok' : 'error';
    this.inc('grpc_client_requests_total', { method: normalized, status });
    this.inc(
      'grpc_client_request_duration_ms_sum',
      { method: normalized, status },
      Math.max(0, latencyMs),
    );
    this.inc('grpc_client_request_duration_ms_count', { method: normalized, status });
    this.inc(
      'grpc_client_request_bytes_total',
      { method: normalized, status },
      Math.max(0, bytes),
    );
    if (fallback) {
      this.inc('grpc_client_fallback_total', { method: normalized });
    }
  }

  snapshot(): {
    count: number;
    errorRate: number;
    fallbackRate: number;
    p50Ms: number;
    p95Ms: number;
  } {
    if (!this.samples.length) {
      return { count: 0, errorRate: 0, fallbackRate: 0, p50Ms: 0, p95Ms: 0 };
    }
    const latencies = this.samples.map((s) => s.latencyMs).sort((a, b) => a - b);
    const errors = this.samples.filter((s) => !s.ok).length;
    const fallbacks = this.samples.filter((s) => s.fallback).length;
    const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? p50;
    return {
      count: this.samples.length,
      errorRate: errors / this.samples.length,
      fallbackRate: fallbacks / this.samples.length,
      p50Ms: Math.round(p50),
      p95Ms: Math.round(p95),
    };
  }

  renderPrometheus(prefix: 'api', pod: string): string[] {
    const lines: string[] = [];
    const groups = new Map<string, Array<[Record<string, string>, number]>>();
    for (const [key, value] of this.counters.entries()) {
      const [suffix, labelJson] = key.split('\u0001');
      const metric = `${prefix}_${suffix}`;
      const labels = JSON.parse(labelJson) as Record<string, string>;
      if (!groups.has(metric)) groups.set(metric, []);
      groups.get(metric)!.push([{ pod, ...labels }, value]);
    }
    for (const [metric, entries] of groups.entries()) {
      lines.push(`# HELP ${metric} gRPC client statistics`);
      lines.push(`# TYPE ${metric} counter`);
      for (const [labels, value] of entries) {
        lines.push(prometheusLine(metric, value, labels));
      }
      lines.push('');
    }
    return lines;
  }

  private inc(
    suffix: string,
    labels: Record<string, string>,
    amount = 1,
  ): void {
    const key = `${suffix}\u0001${JSON.stringify(labels)}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + amount);
  }
}
