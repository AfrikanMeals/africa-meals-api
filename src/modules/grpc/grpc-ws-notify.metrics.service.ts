import { Injectable } from '@nestjs/common';

type RpcSample = { latencyMs: number; ok: boolean; fallback: boolean; atMs: number };

@Injectable()
export class GrpcWsNotifyMetricsService {
  private readonly samples: RpcSample[] = [];
  private readonly maxSamples = 500;

  record(latencyMs: number, ok: boolean, fallback = false): void {
    this.samples.push({ latencyMs, ok, fallback, atMs: Date.now() });
    if (this.samples.length > this.maxSamples) {
      this.samples.splice(0, this.samples.length - this.maxSamples);
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
}
