import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DbMaintenanceService } from '@modules/db-maintenance/db-maintenance.service';
import { RequestStatsStore } from '@modules/request-stats/request-stats.store';
import {
  buildSlowInsights,
  DEFAULT_SLOW_THRESHOLD_MS,
} from '@modules/request-stats/request-stats-slow.util';
import {
  isRequestStatsEnabled,
  requestStatsMaxEntries,
} from '@modules/request-stats/request-stats.util';
import { SseRedisPublishService } from '../../common/sse/sse-redis-publish.service';
import {
  isSseHostOnWs,
  isSseRedisBridgeEnabled,
} from '../../common/sse/sse-redis.channels';
import { sseHealthDedupKey } from './sse-health-dedup.util';

/**
 * Publie snapshots santé / statut public sur Redis pour SSE hébergé sur WS (POLL-000).
 */
@Injectable()
export class SseBackgroundPublisherService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SseBackgroundPublisherService.name);
  private mqttTimer: ReturnType<typeof setInterval> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private lastHealthKey = '';

  constructor(
    private readonly sseRedis: SseRedisPublishService,
    private readonly dbMaintenance: DbMaintenanceService,
    private readonly requestStatsStore: RequestStatsStore,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!isSseRedisBridgeEnabled() || !isSseHostOnWs()) return;
    this.logger.log(
      'SSE background publisher started (mqtt + request-stats; status health probes disabled)',
    );
    void this.publishMqttTick();
    void this.publishRequestStatsTick();
    this.mqttTimer = setInterval(() => void this.publishMqttTick(), 7000);
    const statsMs = Number(this.config.get('REQUEST_STATS_SSE_PUSH_MS')) || 10_000;
    this.statsTimer = setInterval(
      () => void this.publishRequestStatsTick(),
      statsMs,
    );
  }

  onModuleDestroy(): void {
    if (this.mqttTimer) clearInterval(this.mqttTimer);
    if (this.statsTimer) clearInterval(this.statsTimer);
  }

  private async publishMqttTick(): Promise<void> {
    try {
      const mqtt = await this.dbMaintenance.getInfraMqttStatusInternal();
      const payload = {
        type: 'mqtt',
        mqtt,
        checkedAt: new Date().toISOString(),
      };
      await this.maybePublishHealth(payload);
    } catch (e) {
      this.logger.warn(
        `health mqtt tick: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async maybePublishHealth(
    payload: Record<string, unknown>,
  ): Promise<void> {
    const key = sseHealthDedupKey(payload);
    if (key === this.lastHealthKey) return;
    this.lastHealthKey = key;
    await this.sseRedis.publishHealth(payload);
  }

  private async publishRequestStatsTick(): Promise<void> {
    if (
      !isRequestStatsEnabled(this.config.get<string>('REQUEST_STATS_ENABLED'))
    ) {
      return;
    }
    try {
      const query = { limit: 250 };
      const all = this.requestStatsStore.query({ ...query, limit: 500 });
      const entries = this.requestStatsStore.query(query);
      const scoped = this.requestStatsStore.filtered(query);
      await this.sseRedis.publishRequestStats({
        type: 'snapshot',
        source: 'api',
        enabled: true,
        maxEntries: requestStatsMaxEntries(
          this.config.get<string>('REQUEST_STATS_MAX_ENTRIES'),
        ),
        bufferSize: this.requestStatsStore.size(),
        summary: this.requestStatsStore.summaryFor(all),
        slowInsights: buildSlowInsights(
          scoped,
          DEFAULT_SLOW_THRESHOLD_MS,
          'api',
        ),
        entries,
        at: new Date().toISOString(),
      });
    } catch (e) {
      this.logger.warn(
        `request-stats tick: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
