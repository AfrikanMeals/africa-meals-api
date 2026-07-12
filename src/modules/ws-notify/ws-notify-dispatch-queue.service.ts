import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { InfraRuntimeSettingsModel } from '@schemas/infra-runtime-settings.schema';
import { JobsOptions, Queue, Worker } from 'bullmq';
import {
  formatBullmqRedisTarget,
  logBullmqDisabledReason,
  readBullmqRedisConnectionFromConfig,
} from '../../common/bullmq-redis-connection';
import { BullmqRedisConnectionsService } from '../../common/redis/bullmq-redis-connections.service';
import { SharedMqttPublisherService } from '../../common/mqtt/shared-mqtt-publisher.service';
import { Model } from 'mongoose';
import { SecretManagerService } from '@modules/secret-manager/secret-manager.service';
import { GrpcWsNotifyClientService } from '@modules/grpc/grpc-ws-notify.client.service';
import { GrpcWsNotifyMetricsService } from '@modules/grpc/grpc-ws-notify.metrics.service';

type WsNotifyQueueJob = {
  pathSuffix: string;
  payload: Record<string, unknown>;
};
export type MqttRuntimeStatus = {
  enabled: boolean;
  state: 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'error';
  lastError: string | null;
  lastTopicSeen: string | null;
  lastMessageAt: string | null;
};
const INFRA_RUNTIME_SETTINGS_KEY = 'default';
const WS_NOTIFY_SUFFIX_TO_TOPIC = {
  'inbox/refresh': 'inbox/refresh',
  'order/update': 'order/update',
  'order/tracking': 'order/tracking',
  'order/changed': 'order/changed',
  'order/staff-broadcast': 'order/staff-broadcast',
  'order/delivery-offer': 'order/delivery-offer',
  'stripe/connect-status': 'stripe/connect-status',
  'ads-targeting/event': 'ads-targeting/event',
  'ad-manager/event': 'ad-manager/event',
  'chat/archive-order-delivery': 'chat/archive-order-delivery',
  'delivery-agent/presence': 'delivery-agent/presence',
  'platform/maintenance': 'platform/maintenance',
} as const;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

@Injectable()
export class WsNotifyDispatchQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WsNotifyDispatchQueueService.name);
  private queue: Queue<WsNotifyQueueJob> | null = null;
  private worker: Worker<WsNotifyQueueJob, void> | null = null;
  private queueEnabled = false;
  private mqttLastPublishedTopic: string | null = null;
  private mqttLastPublishedAtMs: number | null = null;
  private infraSettingsCache = {
    redisManagerEnabled: true,
    mqBrokerEnabled: true,
    grpcWsNotifyEnabled: false,
  };
  private infraSettingsReadAtMs = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly bullRedis: BullmqRedisConnectionsService,
    private readonly sharedMqtt: SharedMqttPublisherService,
    private readonly secrets: SecretManagerService,
    private readonly grpcWsNotify: GrpcWsNotifyClientService,
    private readonly grpcMetrics: GrpcWsNotifyMetricsService,
    @InjectModel(InfraRuntimeSettingsModel.name)
    private readonly infraRuntimeSettingsModel: Model<InfraRuntimeSettingsModel>,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.bullRedis.isEnabled()) {
      logBullmqDisabledReason();
      return;
    }
    const queueName =
      this.config.get<string>('WS_NOTIFY_QUEUE_NAME')?.trim() || 'ws-notify';
    const concurrency = parsePositiveInt(
      this.config.get<string>('WS_NOTIFY_QUEUE_CONCURRENCY'),
      20,
    );

    this.queue = new Queue<WsNotifyQueueJob>(queueName, this.bullRedis.queueOpts());
    const externalWorker = this.isExternalWorkerEnabled();
    if (externalWorker) {
      this.queueEnabled = true;
      this.logger.log(
        `BullMQ queue enabled (external worker): ${queueName} — in-process worker skipped`,
      );
      return;
    }
    this.worker = new Worker<WsNotifyQueueJob, void>(
      queueName,
      async (job) => {
        await this.postInternal(job.data.pathSuffix, job.data.payload);
      },
      this.bullRedis.workerOpts('ws-notify', { concurrency }),
    );
    this.worker.on('failed', (job, error) => {
      const id = job?.id ?? 'unknown';
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`ws notify queue job failed id=${id}: ${msg}`);
    });
    this.queueEnabled = true;
    const bullTarget = readBullmqRedisConnectionFromConfig(this.config);
    this.logger.log(
      `BullMQ queue enabled: ${queueName} @ ${
        bullTarget ? formatBullmqRedisTarget(bullTarget) : 'unknown'
      }`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.worker = null;
    this.queue = null;
    this.queueEnabled = false;
  }

  private isExternalWorkerEnabled(): boolean {
    const raw = (this.config.get<string>('WS_NOTIFY_WORKER_EXTERNAL') ?? 'false')
      .trim()
      .toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  }

  /** Exposé pour le worker externe GRPC-302. */
  async processQueueJob(job: WsNotifyQueueJob): Promise<void> {
    await this.postInternal(job.pathSuffix, job.payload);
  }

  dispatch(pathSuffix: string, payload: Record<string, unknown>): void {
    void this.dispatchAsync(pathSuffix, payload);
  }

  batchDispatch(
    items: Array<{ pathSuffix: string; payload: Record<string, unknown> }>,
  ): void {
    void this.batchDispatchAsync(items);
  }

  private async batchDispatchAsync(
    items: Array<{ pathSuffix: string; payload: Record<string, unknown> }>,
  ): Promise<void> {
    if (!items.length) return;
    const infraSettings = await this.readInfraSettings();
    if (
      this.grpcWsNotify.shouldUseGrpc(infraSettings.grpcWsNotifyEnabled)
    ) {
      const grpcOk = await this.grpcWsNotify.batchDispatch(items).catch(() => false);
      if (grpcOk) return;
      if (!this.grpcWsNotify.httpFallbackEnabled()) return;
    }
    for (const item of items) {
      await this.dispatchAsync(item.pathSuffix, item.payload);
    }
  }

  getMqttStatus(): MqttRuntimeStatus {
    const base = this.sharedMqtt.getStatus();
    return {
      enabled: base.enabled,
      state: base.state,
      lastError: base.lastError,
      lastTopicSeen: this.mqttLastPublishedTopic,
      lastMessageAt: this.mqttLastPublishedAtMs
        ? new Date(this.mqttLastPublishedAtMs).toISOString()
        : null,
    };
  }

  isMqttConnected(): boolean {
    return this.sharedMqtt.isConnected();
  }

  recoverMqttAfterOutage(): void {
    this.sharedMqtt.recoverAfterOutage();
  }

  private async dispatchAsync(
    pathSuffix: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const suffix = pathSuffix.trim();
    if (!suffix) return;
    const normalizedPayload = { ...payload };
    const infraSettings = await this.readInfraSettings();

    if (
      this.grpcWsNotify.shouldUseGrpc(infraSettings.grpcWsNotifyEnabled)
    ) {
      const grpcOk = await this.grpcWsNotify
        .dispatch(suffix, normalizedPayload)
        .catch(() => false);
      if (grpcOk) {
        return;
      }
      if (!this.grpcWsNotify.httpFallbackEnabled()) {
        this.grpcMetrics.record(suffix, 0, false, false);
        this.logger.warn(`gRPC dispatch failed (${suffix}) — fallback HTTP disabled`);
        return;
      }
      this.grpcMetrics.record(suffix, 0, false, true);
    }

    const mirrorNotifyEventsOverHttp =
      suffix === 'inbox/refresh' ||
      suffix === 'order/staff-broadcast' ||
      suffix === 'order/changed' ||
      suffix === 'order/update' ||
      suffix === 'order/tracking' ||
      suffix === 'order/delivery-offer';
    let mqttPublished = false;
    if (infraSettings.mqBrokerEnabled) {
      mqttPublished = await this.publishViaMqtt(
        suffix,
        normalizedPayload,
      );
      if (mqttPublished && !mirrorNotifyEventsOverHttp) return;
    }
    if (
      !infraSettings.redisManagerEnabled ||
      !this.queueEnabled ||
      !this.queue
    ) {
      await this.postInternal(suffix, normalizedPayload).catch(
        (error: unknown) => {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.warn(`ws notify direct failed (${suffix}): ${msg}`);
        },
      );
      return;
    }

    const opts: JobsOptions = {
      attempts: parsePositiveInt(
        this.config.get<string>('WS_NOTIFY_QUEUE_ATTEMPTS'),
        4,
      ),
      backoff: {
        type: 'exponential',
        delay: parsePositiveInt(
          this.config.get<string>('WS_NOTIFY_QUEUE_BACKOFF_MS'),
          750,
        ),
      },
      removeOnComplete: parsePositiveInt(
        this.config.get<string>('WS_NOTIFY_QUEUE_KEEP_COMPLETED'),
        1000,
      ),
      removeOnFail: parsePositiveInt(
        this.config.get<string>('WS_NOTIFY_QUEUE_KEEP_FAILED'),
        5000,
      ),
    };

    await this.queue
      .add(
        `notify:${suffix}`,
        {
          pathSuffix: suffix,
          payload: normalizedPayload,
        },
        opts,
      )
      .catch((error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`ws notify enqueue failed (${suffix}): ${msg}`);
        return this.postInternal(suffix, normalizedPayload).catch(
          () => undefined,
        );
      });
  }

  private async readInfraSettings(): Promise<{
    redisManagerEnabled: boolean;
    mqBrokerEnabled: boolean;
    grpcWsNotifyEnabled: boolean;
  }> {
    const ttlMs = parsePositiveInt(
      this.config.get<string>('INFRA_RUNTIME_SETTINGS_CACHE_MS'),
      10_000,
    );
    const now = Date.now();
    if (now - this.infraSettingsReadAtMs < ttlMs) {
      return this.infraSettingsCache;
    }
    this.infraSettingsReadAtMs = now;
    try {
      const doc = await this.infraRuntimeSettingsModel
        .findOne({ key: INFRA_RUNTIME_SETTINGS_KEY })
        .lean()
        .exec();
      if (!doc) {
        this.infraSettingsCache = {
          redisManagerEnabled: true,
          mqBrokerEnabled: true,
          grpcWsNotifyEnabled: false,
        };
      } else {
        this.infraSettingsCache = {
          redisManagerEnabled: doc.redisManagerEnabled !== false,
          mqBrokerEnabled: doc.mqBrokerEnabled !== false,
          grpcWsNotifyEnabled: doc.grpcWsNotifyEnabled === true,
        };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`infra settings read failed: ${msg}`);
    }
    return this.infraSettingsCache;
  }

  private async postInternal(
    pathSuffix: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const raw = this.config.get<string>('AFRICA_MEALS_WS_INTERNAL_URL')?.trim();
    const secret =
      (await this.secrets.resolveString('api', 'INTERNAL_NOTIFY_SECRET')) ||
      this.config.get<string>('INTERNAL_WS_NOTIFY_SECRET')?.trim();
    if (!raw || !secret) {
      return;
    }
    const base = raw.replace(/\/+$/, '');
    const path = base.endsWith('/api')
      ? `${base}/internal/${pathSuffix}`
      : `${base}/api/internal/${pathSuffix}`;
    const response = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(
        parsePositiveInt(
          this.config.get<string>('WS_NOTIFY_REQUEST_TIMEOUT_MS'),
          8000,
        ),
      ),
    });
    if (!response.ok) {
      throw new Error(`status=${response.status}`);
    }
  }

  private async publishViaMqtt(
    pathSuffix: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    if (!this.sharedMqtt.isConnected()) return false;
    const topicSuffix =
      WS_NOTIFY_SUFFIX_TO_TOPIC[
        pathSuffix as keyof typeof WS_NOTIFY_SUFFIX_TO_TOPIC
      ];
    if (!topicSuffix) return false;
    const prefix =
      this.config.get<string>('MQTT_TOPIC_PREFIX')?.trim() ||
      'africameals/internal/ws';
    const topic = `${prefix}/${topicSuffix}`;
    const qosRaw = Number(this.config.get<string>('MQTT_QOS') ?? '1');
    const qos = (qosRaw === 2 ? 2 : qosRaw === 0 ? 0 : 1) as 0 | 1 | 2;
    const body = JSON.stringify(payload);
    try {
      await this.sharedMqtt.publish(topic, body, qos);
      this.mqttLastPublishedTopic = topic;
      this.mqttLastPublishedAtMs = Date.now();
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`MQTT publish failed topic=${topic}: ${msg}`);
      return false;
    }
  }
}
