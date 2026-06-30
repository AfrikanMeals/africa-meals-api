import { Injectable } from '@nestjs/common';
import {
  httpStatusClass,
  normalizePrometheusMethod,
  normalizePrometheusRoute,
  prometheusLine,
} from './request-stats-prometheus.util';

type CounterKind = 'http' | 'ws';

type RecordInput = {
  kind: CounterKind;
  method: string;
  route: string;
  statusCode: number | null;
  durationMs: number;
  responseBytes?: number;
  requestBytes?: number;
};

@Injectable()
export class RequestStatsPrometheusAggregator {
  private readonly counters = new Map<string, number>();
  private readonly maxSeries = 4_000;

  record(input: RecordInput): void {
    if (this.counters.size > this.maxSeries) return;
    const method = normalizePrometheusMethod(input.method);
    const route = normalizePrometheusRoute(input.route);
    const statusClass = httpStatusClass(input.statusCode);
    const statusCode =
      input.statusCode != null && Number.isFinite(input.statusCode)
        ? String(Math.trunc(input.statusCode))
        : 'unknown';
    const base = {
      method,
      route,
      status_class: statusClass,
    };
    const prefix = input.kind === 'http' ? 'http' : 'ws';
    this.inc(`${prefix}_requests_total`, base);
    this.inc(`${prefix}_request_duration_ms_sum`, base, Math.max(0, input.durationMs));
    this.inc(`${prefix}_request_duration_ms_count`, base, 1);
    this.inc(`${prefix}_response_bytes_total`, base, Math.max(0, input.responseBytes ?? 0));
    this.inc(`${prefix}_request_bytes_total`, base, Math.max(0, input.requestBytes ?? 0));
    this.inc(`${prefix}_requests_by_status_total`, {
      method,
      route,
      status_code: statusCode,
    });
    if (statusClass === '2xx' || statusClass === '3xx') {
      this.inc(`${prefix}_requests_success_total`, base);
    }
    if (statusClass === '4xx' || statusClass === '5xx') {
      this.inc(`${prefix}_requests_failure_total`, base);
    }
  }

  render(prefix: 'api' | 'ws', pod: string): string[] {
    const lines: string[] = [];
    const groups = new Map<
      string,
      { help: string; type: 'counter'; entries: Array<[Record<string, string>, number]> }
    >();

    for (const [key, value] of this.counters.entries()) {
      const [metricSuffix, labelJson] = key.split('\u0001');
      const labels = JSON.parse(labelJson) as Record<string, string>;
      const metric = `${prefix}_${metricSuffix}`;
      if (!groups.has(metric)) {
        groups.set(metric, {
          help: `${metric} request statistics`,
          type: 'counter',
          entries: [],
        });
      }
      groups.get(metric)!.entries.push([{ pod, ...labels }, value]);
    }

    for (const [metric, group] of groups.entries()) {
      lines.push(`# HELP ${metric} ${group.help}`);
      lines.push(`# TYPE ${metric} ${group.type}`);
      for (const [labels, value] of group.entries) {
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
