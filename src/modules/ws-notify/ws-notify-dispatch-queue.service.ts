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
  connect as mqttConnect,
  type IClientOptions,
  type MqttClient,
} from 'mqtt';
import { Model } from 'mongoose';

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
  'order/staff-broadcast': 'order/staff-broadcast',
  'stripe/connect-status': 'stripe/connect-status',
  'ads-targeting/event': 'ads-targeting/event',
  'ad-manager/event': 'ad-manager/event',
  'chat/archive-order-delivery': 'chat/archive-order-delivery',
} as const;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function toBool(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function isMqttAuthError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('not authorized') || m.includes('bad user name or password')
  );
}

@Injectable()
export class WsNotifyDispatchQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WsNotifyDispatchQueueService.name);
  private queue: Queue<WsNotifyQueueJob> | null = null;
  private worker: Worker<WsNotifyQueueJob, void> | null = null;
  private queueEnabled = false;
  private mqttClient: MqttClient | null = null;
  private mqttConnected = false;
  private mqttState: MqttRuntimeStatus['state'] = 'disabled';
  private mqttLastError: string | null = null;
  private mqttLastPublishedTopic: string | null = null;
  private mqttLastPublishedAtMs: number | null = null;
  private infraSettingsCache = {
    redisManagerEnabled: true,
    mqBrokerEnabled: true,
  };
  private infraSettingsReadAtMs = 0;

  constructor(
    private readonly config: ConfigService,
    @InjectModel(InfraRuntimeSettingsModel.name)
    private readonly infraRuntimeSettingsModel: Model<InfraRuntimeSettingsModel>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.initMqttClient();
    const connection = this.redisConnectionConfig();
    if (!connection) {
      this.logger.log('BullMQ disabled (REDIS_* absent) -> direct notify mode');
      return;
    }
    const queueName =
      this.config.get<string>('WS_NOTIFY_QUEUE_NAME')?.trim() || 'ws-notify';
    const concurrency = parsePositiveInt(
      this.config.get<string>('WS_NOTIFY_QUEUE_CONCURRENCY'),
      20,
    );

    this.queue = new Queue<WsNotifyQueueJob>(queueName, { connection });
    this.worker = new Worker<WsNotifyQueueJob, void>(
      queueName,
      async (job) => {
        await this.postInternal(job.data.pathSuffix, job.data.payload);
      },
      { connection, concurrency },
    );
    this.worker.on('failed', (job, error) => {
      const id = job?.id ?? 'unknown';
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`ws notify queue job failed id=${id}: ${msg}`);
    });
    const onRedisError = (err: Error) => {
      this.logger.warn(`BullMQ Redis error: ${err.message}`);
    };
    this.queue.on('error', onRedisError);
    this.worker.on('error', onRedisError);
    this.queueEnabled = true;
    this.logger.log(`BullMQ queue enabled: ${queueName}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.mqttClient) {
      this.mqttClient.end(true);
      this.mqttClient = null;
      this.mqttConnected = false;
      this.mqttState = 'disabled';
    }
    await this.worker?.close();
    await this.queue?.close();
    this.worker = null;
    this.queue = null;
    this.queueEnabled = false;
  }

  dispatch(pathSuffix: string, payload: Record<string, unknown>): void {
    void this.dispatchAsync(pathSuffix, payload);
  }

  getMqttStatus(): MqttRuntimeStatus {
    return {
      enabled: this.mqttClient != null,
      state: this.mqttState,
      lastError: this.mqttLastError,
      lastTopicSeen: this.mqttLastPublishedTopic,
      lastMessageAt: this.mqttLastPublishedAtMs
        ? new Date(this.mqttLastPublishedAtMs).toISOString()
        : null,
    };
  }

  private async dispatchAsync(
    pathSuffix: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const suffix = pathSuffix.trim();
    if (!suffix) return;
    const normalizedPayload = { ...payload };
    const infraSettings = await this.readInfraSettings();
    if (infraSettings.mqBrokerEnabled) {
      const mqttPublished = await this.publishViaMqtt(
        suffix,
        normalizedPayload,
      );
      if (mqttPublished) return;
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
        };
      } else {
        this.infraSettingsCache = {
          redisManagerEnabled: doc.redisManagerEnabled !== false,
          mqBrokerEnabled: doc.mqBrokerEnabled !== false,
        };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`infra settings read failed: ${msg}`);
    }
    return this.infraSettingsCache;
  }

  private redisConnectionConfig(): {
    host: string;
    port: number;
    username?: string;
    password?: string;
    tls?: Record<string, unknown>;
  } | null {
    const redisUrl = this.config.get<string>('REDIS_URL')?.trim();
    if (redisUrl) {
      try {
        const parsed = new URL(redisUrl);
        return {
          host: parsed.hostname,
          port: parsePositiveInt(
            parsed.port,
            parsed.protocol === 'rediss:' ? 6380 : 6379,
          ),
          username: parsed.username || undefined,
          password: parsed.password || undefined,
          tls:
            parsed.protocol === 'rediss:' ||
            toBool(this.config.get<string>('REDIS_TLS'))
              ? {}
              : undefined,
        };
      } catch (_) {
        this.logger.warn('Invalid REDIS_URL, BullMQ disabled');
        return null;
      }
    }

    const host = this.config.get<string>('REDIS_HOST')?.trim();
    if (!host) return null;
    return {
      host,
      port: parsePositiveInt(this.config.get<string>('REDIS_PORT'), 6379),
      username: this.config.get<string>('REDIS_USERNAME')?.trim() || undefined,
      password: this.config.get<string>('REDIS_PASSWORD')?.trim() || undefined,
      tls: toBool(this.config.get<string>('REDIS_TLS')) ? {} : undefined,
    };
  }

  private async postInternal(
    pathSuffix: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const raw = this.config.get<string>('AFRICA_MEALS_WS_INTERNAL_URL')?.trim();
    const secret =
      this.config.get<string>('INTERNAL_NOTIFY_SECRET')?.trim() ||
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

  private initMqttClient(): void {
    const cfg = this.mqttConfig();
    if (!cfg) {
      this.logger.log('MQTT disabled (MQTT_BROKER_* absent)');
      this.mqttState = 'disabled';
      return;
    }
    this.mqttState = 'connecting';
    const client = mqttConnect(cfg.url, cfg.options);
    client.on('connect', () => {
      this.mqttConnected = true;
      this.mqttState = 'connected';
      this.mqttLastError = null;
      this.logger.log(`MQTT connected: ${cfg.url}`);
    });
    client.on('reconnect', () => {
      this.mqttState = 'reconnecting';
      this.logger.warn('MQTT reconnecting...');
    });
    client.on('error', (error) => {
      const msg = error instanceof Error ? error.message : String(error);
      this.mqttState = 'error';
      this.mqttLastError = msg;
      this.logger.warn(`MQTT error: ${msg}`);
      if (isMqttAuthError(msg)) {
        this.logger.warn(
          'MQTT auth rejected; stopping reconnect loop until service restart or credential change.',
        );
        this.mqttConnected = false;
        client.end(true);
      }
    });
    client.on('close', () => {
      this.mqttConnected = false;
      if (this.mqttState !== 'error') {
        this.mqttState = 'connecting';
      }
    });
    this.mqttClient = client;
  }

  private mqttConfig(): {
    url: string;
    options: IClientOptions;
  } | null {
    const direct = this.config.get<string>('MQTT_BROKER_URL')?.trim();
    const host = this.config.get<string>('MQTT_BROKER_HOST')?.trim();
    if (!direct && !host) return null;
    const port = parsePositiveInt(
      this.config.get<string>('MQTT_BROKER_PORT'),
      8883,
    );
    const protocol =
      this.config.get<string>('MQTT_BROKER_PROTOCOL')?.trim() || 'mqtts';
    const url = direct || `${protocol}://${host}:${port}`;
    return {
      url,
      options: {
        username: this.config.get<string>('MQTT_BROKER_USERNAME')?.trim(),
        password: this.config.get<string>('MQTT_BROKER_PASSWORD')?.trim(),
        connectTimeout: parsePositiveInt(
          this.config.get<string>('MQTT_CONNECT_TIMEOUT_MS'),
          8000,
        ),
        keepalive: parsePositiveInt(
          this.config.get<string>('MQTT_KEEPALIVE_SEC'),
          30,
        ),
        reconnectPeriod: parsePositiveInt(
          this.config.get<string>('MQTT_RECONNECT_MS'),
          2000,
        ),
      },
    };
  }

  private async publishViaMqtt(
    pathSuffix: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    if (!this.mqttClient || !this.mqttConnected) return false;
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
    const qos = qosRaw === 2 ? 2 : qosRaw === 0 ? 0 : 1;
    const body = JSON.stringify(payload);
    try {
      await new Promise<void>((resolve, reject) => {
        this.mqttClient!.publish(
          topic,
          body,
          { qos, retain: false },
          (error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          },
        );
      });
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
