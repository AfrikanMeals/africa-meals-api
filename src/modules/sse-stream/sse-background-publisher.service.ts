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
import { PublicStatusProbeService } from './public-status-probe.service';

/**
 * Publie snapshots santé / statut public sur Redis pour SSE hébergé sur WS (POLL-000).
 */
@Injectable()
export class SseBackgroundPublisherService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SseBackgroundPublisherService.name);
  private mqttTimer: ReturnType<typeof setInterval> | null = null;
  private checksTimer: ReturnType<typeof setInterval> | null = null;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private lastHealthKey = '';

  constructor(
    private readonly sseRedis: SseRedisPublishService,
    private readonly dbMaintenance: DbMaintenanceService,
    private readonly statusProbes: PublicStatusProbeService,
    private readonly requestStatsStore: RequestStatsStore,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!isSseRedisBridgeEnabled() || !isSseHostOnWs()) return;
    this.logger.log(
      'SSE background publisher started (health + status + request-stats)',
    );
    void this.publishMqttTick();
    void this.publishChecksTick();
    void this.publishStatusTick();
    void this.publishRequestStatsTick();
    this.mqttTimer = setInterval(() => void this.publishMqttTick(), 7000);
    this.checksTimer = setInterval(() => void this.publishChecksTick(), 120_000);
    this.statusTimer = setInterval(() => void this.publishStatusTick(), 60_000);
    const statsMs = Number(this.config.get('REQUEST_STATS_SSE_PUSH_MS')) || 10_000;
    this.statsTimer = setInterval(
      () => void this.publishRequestStatsTick(),
      statsMs,
    );
  }

  onModuleDestroy(): void {
    if (this.mqttTimer) clearInterval(this.mqttTimer);
    if (this.checksTimer) clearInterval(this.checksTimer);
    if (this.statusTimer) clearInterval(this.statusTimer);
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

  private async publishChecksTick(): Promise<void> {
    try {
      const [checks, runtime] = await Promise.all([
        this.dbMaintenance.runAllSystemHealthChecksInternal(),
        this.dbMaintenance.getInfraRuntimeSettingsInternal(),
      ]);
      const payload = {
        type: 'snapshot',
        runtime,
        checks,
        checkedAt: new Date().toISOString(),
      };
      await this.maybePublishHealth(payload);
    } catch (e) {
      this.logger.warn(
        `health checks tick: ${e instanceof Error ? e.message : String(e)}`,
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

  private async publishStatusTick(): Promise<void> {
    try {
      const snapshot = await this.statusProbes.probeAll();
      await this.sseRedis.publishStatus({ type: 'status', ...snapshot });
    } catch (e) {
      this.logger.warn(
        `status tick: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
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
