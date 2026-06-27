import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { RequestStatsStore } from '@modules/request-stats/request-stats.store';

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

@Injectable()
export class PrometheusMetricsService {
  constructor(
    private readonly config: ConfigService,
    private readonly requestStats: RequestStatsStore,
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

    lines.push('');
    return `${lines.join('\n')}\n`;
  }
}
