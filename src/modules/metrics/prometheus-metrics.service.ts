import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { GrpcWsNotifyMetricsService } from '@modules/grpc/grpc-ws-notify.metrics.service';
import { RequestStatsPrometheusAggregator } from '@modules/request-stats/request-stats-prometheus.aggregator';
import { RequestStatsStore } from '@modules/request-stats/request-stats.store';
import { GraphMetricsService } from '@modules/neo4j/graph-metrics.service';

function escLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function line(
  name: string,
  value: number,
  labels?: Record<string, string>,
): string {
  if (!labels || !Object.keys(labels).length) {
    return `${name} ${value}`;
  }
  const parts = Object.entries(labels)
    .map(([k, v]) => `${k}="${escLabel(v)}"`)
    .join(',');
  return `${name}{${parts}} ${value}`;
}

function prometheusLine(
  name: string,
  value: number,
  labels?: Record<string, string>,
): string {
  return line(name, value, labels);
}

@Injectable()
export class PrometheusMetricsService {
  constructor(
    private readonly config: ConfigService,
    private readonly requestStats: RequestStatsStore,
    @Optional()
    private readonly requestStatsPrometheus?: RequestStatsPrometheusAggregator,
    @Optional()
    private readonly grpcClientMetrics?: GrpcWsNotifyMetricsService,
    @Optional()
    private readonly graphMetrics?: GraphMetricsService,
    @Optional() @InjectConnection() private readonly mongoose?: Connection,
  ) {}

  render(): string {
    const pod = this.config.get<string>('POD_NAME')?.trim() || 'unknown';
    const mem = process.memoryUsage();
    const lines: string[] = [
      '# HELP api_up africa-meals-api process is serving metrics',
      '# TYPE api_up gauge',
      line('api_up', 1, { pod }),
      '',
      '# HELP api_process_uptime_seconds Node process uptime',
      '# TYPE api_process_uptime_seconds gauge',
      line('api_process_uptime_seconds', process.uptime(), { pod }),
      '',
      '# HELP api_process_resident_memory_bytes RSS memory',
      '# TYPE api_process_resident_memory_bytes gauge',
      line('api_process_resident_memory_bytes', mem.rss, { pod }),
      '',
      '# HELP api_process_heap_used_bytes V8 heap used',
      '# TYPE api_process_heap_used_bytes gauge',
      line('api_process_heap_used_bytes', mem.heapUsed, { pod }),
    ];

    const readyState = this.mongoose?.readyState ?? -1;
    lines.push(
      '',
      '# HELP api_mongoose_ready_state Mongoose connection state (1=connected)',
      '# TYPE api_mongoose_ready_state gauge',
      line('api_mongoose_ready_state', readyState, { pod }),
    );

    const stats = this.requestStats.filtered({});
    const httpCount = stats.filter((e) => e.kind === 'http').length;
    lines.push(
      '',
      '# HELP api_request_stats_buffer_entries Buffered request stats entries',
      '# TYPE api_request_stats_buffer_entries gauge',
      line('api_request_stats_buffer_entries', this.requestStats.size(), {
        pod,
      }),
      '',
      '# HELP api_request_stats_events Recent events in buffer by kind',
      '# TYPE api_request_stats_events gauge',
      line('api_request_stats_events', httpCount, { pod, kind: 'http' }),
    );

    if (this.requestStatsPrometheus) {
      lines.push(...this.requestStatsPrometheus.render('api', pod));
    }
    if (this.graphMetrics) {
      lines.push(...this.graphMetrics.renderPrometheus(pod));
    }

    if (this.grpcClientMetrics) {
      lines.push(...this.grpcClientMetrics.renderPrometheus('api', pod));
      const snap = this.grpcClientMetrics.snapshot();
      lines.push(
        '# HELP api_grpc_client_window_samples Recent gRPC client samples in window',
        '# TYPE api_grpc_client_window_samples gauge',
        prometheusLine('api_grpc_client_window_samples', snap.count, { pod }),
        '# HELP api_grpc_client_window_error_rate Recent gRPC client error rate',
        '# TYPE api_grpc_client_window_error_rate gauge',
        prometheusLine('api_grpc_client_window_error_rate', snap.errorRate, { pod }),
        '# HELP api_grpc_client_window_p95_ms Recent gRPC client p95 latency ms',
        '# TYPE api_grpc_client_window_p95_ms gauge',
        prometheusLine('api_grpc_client_window_p95_ms', snap.p95Ms, { pod }),
        '',
      );
    }

    lines.push('');
    return `${lines.join('\n')}\n`;
  }
}
