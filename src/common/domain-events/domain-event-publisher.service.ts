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
import {
  bullmqJobId,
  logBullmqDisabledReason,
  parsePositiveInt,
  readBullmqQueueBaseOptionsFromConfig,
} from '../bullmq-redis-connection';
import { DomainEventIdempotencyStore } from './domain-event-idempotency.store';
import { DomainEventRegistryService } from './domain-event-registry.service';
import {
  DOMAIN_EVENT_TOPIC_PREFIX,
  DomainEventType,
  domainEventTopicFor,
} from './domain-event-types';
import {
  DomainEventDraft,
  DomainEventEnvelope,
} from './domain-event.types';
import {
  DomainEventPublishMode,
  DomainEventPublishResult,
} from './domain-event-publisher.types';

type DomainEventQueueJob = {
  envelope: DomainEventEnvelope;
  topic: string;
};

type DomainEventHandlerQueueJob = {
  envelope: DomainEventEnvelope;
};

const INFRA_RUNTIME_SETTINGS_KEY = 'default';

function isDomainEventsEnabled(config: ConfigService): boolean {
  const raw = (config.get<string>('DOMAIN_EVENTS_ENABLED') ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function isHandlersAsyncEnabled(config: ConfigService): boolean {
  const raw = (config.get<string>('DOMAIN_EVENTS_HANDLERS_ASYNC') ?? 'true')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function isMqttAuthError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('not authorized') || m.includes('bad user name or password')
  );
}

@Injectable()
export class DomainEventPublisherService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DomainEventPublisherService.name);
  private queue: Queue<DomainEventQueueJob> | null = null;
  private worker: Worker<DomainEventQueueJob, void> | null = null;
  private handlersQueue: Queue<DomainEventHandlerQueueJob> | null = null;
  private handlersWorker: Worker<DomainEventHandlerQueueJob, void> | null = null;
  private queueEnabled = false;
  private handlersQueueEnabled = false;
  private mqttClient: MqttClient | null = null;
  private mqttConnected = false;
  private infraSettingsCache = {
    redisManagerEnabled: true,
    mqBrokerEnabled: true,
  };
  private infraSettingsReadAtMs = 0;
  private inProcessHandler: ((envelope: DomainEventEnvelope) => Promise<void>) | null =
    null;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: DomainEventRegistryService,
    private readonly idempotency: DomainEventIdempotencyStore,
    @InjectModel(InfraRuntimeSettingsModel.name)
    private readonly infraRuntimeSettingsModel: Model<InfraRuntimeSettingsModel>,
  ) {}

  async onModuleInit(): Promise<void> {
    this.initMqttClient();
    const queueOpts = readBullmqQueueBaseOptionsFromConfig(this.config);
    if (!queueOpts) {
      logBullmqDisabledReason();
      this.logger.log('Domain events -> direct MQTT / log mode');
      return;
    }

    const queueName =
      this.config.get<string>('DOMAIN_EVENTS_QUEUE_NAME')?.trim() ||
      'domain-events';
    const concurrency = parsePositiveInt(
      this.config.get<string>('DOMAIN_EVENTS_QUEUE_CONCURRENCY'),
      10,
    );

    this.queue = new Queue<DomainEventQueueJob>(queueName, queueOpts);
    this.worker = new Worker<DomainEventQueueJob, void>(
      queueName,
      async (job) => {
        await this.publishEnvelopeToMqtt(
          job.data.envelope,
          job.data.topic,
          'worker',
        );
      },
      { ...queueOpts, concurrency },
    );
    this.worker.on('failed', (job, error) => {
      const id = job?.id ?? 'unknown';
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`domain-events job failed id=${id}: ${msg}`);
    });
    const onRedisError = (err: Error) => {
      this.logger.warn(`domain-events BullMQ Redis error: ${err.message}`);
    };
    this.queue.on('error', onRedisError);
    this.worker.on('error', onRedisError);
    this.queueEnabled = true;
    this.logger.log(`Domain events BullMQ queue enabled: ${queueName}`);

    const handlersQueueName =
      this.config.get<string>('DOMAIN_EVENTS_HANDLERS_QUEUE_NAME')?.trim() ||
      'domain-events-handlers';
    const handlersConcurrency = parsePositiveInt(
      this.config.get<string>('DOMAIN_EVENTS_HANDLERS_QUEUE_CONCURRENCY'),
      5,
    );
    this.handlersQueue = new Queue<DomainEventHandlerQueueJob>(
      handlersQueueName,
      queueOpts,
    );
    this.handlersWorker = new Worker<DomainEventHandlerQueueJob, void>(
      handlersQueueName,
      async (job) => {
        await this.runInProcessHandler(job.data.envelope);
      },
      { ...queueOpts, concurrency: handlersConcurrency },
    );
    this.handlersWorker.on('failed', (job, error) => {
      const id = job?.id ?? 'unknown';
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`domain-events-handlers job failed id=${id}: ${msg}`);
    });
    this.handlersQueue.on('error', onRedisError);
    this.handlersWorker.on('error', onRedisError);
    this.handlersQueueEnabled = true;
    this.logger.log(
      `Domain events handlers BullMQ queue enabled: ${handlersQueueName}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.mqttClient) {
      this.mqttClient.end(true);
      this.mqttClient = null;
      this.mqttConnected = false;
    }
    await this.worker?.close();
    await this.queue?.close();
    await this.handlersWorker?.close();
    await this.handlersQueue?.close();
    this.worker = null;
    this.queue = null;
    this.handlersWorker = null;
    this.handlersQueue = null;
    this.queueEnabled = false;
    this.handlersQueueEnabled = false;
  }

  registerInProcessHandler(
    handler: (envelope: DomainEventEnvelope) => Promise<void>,
  ): void {
    this.inProcessHandler = handler;
  }

  /**
   * Valide le draft, applique l'idempotence, puis enqueue ou publie MQTT.
   * Ne bloque pas sur le traitement consommateur (enqueue / fire-and-forget MQTT).
   */
  async publish<T extends DomainEventType>(
    draft: DomainEventDraft<T>,
  ): Promise<DomainEventPublishResult> {
    const envelope = this.registry.buildForPublish(draft);
    return this.publishEnvelope(envelope);
  }

  async publishEnvelope(
    envelope: DomainEventEnvelope,
  ): Promise<DomainEventPublishResult> {
    const started = performance.now();
    const validated = this.registry.validateEnvelope(envelope);
    const topic = this.topicFor(validated.type);

    if (!isDomainEventsEnabled(this.config)) {
      this.logger.debug(
        `Domain events disabled — skipped ${validated.type} id=${validated.id}`,
      );
      return this.result(validated, 'skipped', false, 'domain_events_disabled');
    }

    const claimed = await this.idempotency.tryClaim(validated.id);
    if (!claimed) {
      this.logger.debug(
        `Domain event duplicate skipped type=${validated.type} id=${validated.id}`,
      );
      return this.result(validated, 'duplicate', true, 'duplicate_event_id');
    }

    const infra = await this.readInfraSettings();
    const handlersAsync = isHandlersAsyncEnabled(this.config);

    if (handlersAsync) {
      void this.scheduleInProcessHandler(validated, infra);
    } else {
      await this.scheduleInProcessHandler(validated, infra);
    }

    const busResult = await this.dispatchEnvelopeToBus(validated, topic, infra);
    this.logPublishDuration(validated, started, handlersAsync);
    return busResult;
  }

  private async dispatchEnvelopeToBus(
    envelope: DomainEventEnvelope,
    topic: string,
    infra: { redisManagerEnabled: boolean; mqBrokerEnabled: boolean },
  ): Promise<DomainEventPublishResult> {
    const canQueue =
      infra.redisManagerEnabled && this.queueEnabled && this.queue != null;
    const canMqtt =
      infra.mqBrokerEnabled &&
      this.mqttClient != null &&
      this.mqttConnected;

    if (!canQueue && !canMqtt) {
      this.logger.warn(
        `Domain event handlers scheduled; bus unavailable type=${envelope.type} id=${envelope.id}`,
      );
      return this.result(envelope, 'skipped', true, 'no_broker_available');
    }

    if (canQueue) {
      try {
        await this.enqueue(envelope, topic);
        return this.result(envelope, 'queued', true);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `domain-events enqueue failed id=${envelope.id}: ${msg}`,
        );
        if (!canMqtt) {
          return this.result(envelope, 'skipped', false, 'enqueue_failed');
        }
      }
    }

    if (canMqtt) {
      try {
        await this.publishEnvelopeToMqtt(envelope, topic, 'direct');
        return this.result(envelope, 'mqtt', true);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `domain-events MQTT direct failed id=${envelope.id}: ${msg}`,
        );
        return this.result(envelope, 'skipped', false, 'mqtt_publish_failed');
      }
    }

    return this.result(envelope, 'skipped', false, 'dispatch_failed');
  }

  private logPublishDuration(
    envelope: DomainEventEnvelope,
    started: number,
    handlersAsync: boolean,
  ): void {
    const ms = Math.round(performance.now() - started);
    if (ms > 50) {
      this.logger.warn(
        `Domain event publish slow type=${envelope.type} id=${envelope.id} latencyMs=${ms} handlersAsync=${handlersAsync}`,
      );
      return;
    }
    this.logger.debug(
      `Domain event publish type=${envelope.type} id=${envelope.id} latencyMs=${ms} handlersAsync=${handlersAsync}`,
    );
  }

  private async scheduleInProcessHandler(
    envelope: DomainEventEnvelope,
    infra: { redisManagerEnabled: boolean; mqBrokerEnabled: boolean },
  ): Promise<void> {
    if (!this.inProcessHandler) return;

    if (!isHandlersAsyncEnabled(this.config)) {
      await this.runInProcessHandler(envelope);
      return;
    }

    const canHandlersQueue =
      infra.redisManagerEnabled &&
      this.handlersQueueEnabled &&
      this.handlersQueue != null;

    if (canHandlersQueue) {
      try {
        await this.enqueueHandler(envelope);
        return;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `domain-events-handlers enqueue failed id=${envelope.id}: ${msg}`,
        );
      }
    }

    void this.runInProcessHandler(envelope);
  }

  private async enqueueHandler(
    envelope: DomainEventEnvelope,
  ): Promise<void> {
    if (!this.handlersQueue) return;
    const opts: JobsOptions = {
      jobId: bullmqJobId('handler', envelope.id),
      attempts: parsePositiveInt(
        this.config.get<string>('DOMAIN_EVENTS_HANDLERS_QUEUE_ATTEMPTS'),
        4,
      ),
      backoff: {
        type: 'exponential',
        delay: parsePositiveInt(
          this.config.get<string>('DOMAIN_EVENTS_HANDLERS_QUEUE_BACKOFF_MS'),
          750,
        ),
      },
      removeOnComplete: parsePositiveInt(
        this.config.get<string>('DOMAIN_EVENTS_HANDLERS_QUEUE_KEEP_COMPLETED'),
        2000,
      ),
      removeOnFail: parsePositiveInt(
        this.config.get<string>('DOMAIN_EVENTS_HANDLERS_QUEUE_KEEP_FAILED'),
        5000,
      ),
    };
    await this.handlersQueue.add(
      `handler:${envelope.type}`,
      { envelope },
      opts,
    );
  }

  private async runInProcessHandler(
    envelope: DomainEventEnvelope,
  ): Promise<void> {
    if (!this.inProcessHandler) return;
    try {
      await this.inProcessHandler(envelope);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Domain in-process handler error type=${envelope.type} id=${envelope.id}: ${msg}`,
      );
    }
  }

  private result(
    envelope: DomainEventEnvelope,
    mode: DomainEventPublishMode,
    ok: boolean,
    reason?: string,
  ): DomainEventPublishResult {
    return {
      ok,
      eventId: envelope.id,
      type: envelope.type,
      mode,
      ...(reason ? { reason } : {}),
    };
  }

  private topicFor(type: DomainEventType): string {
    const prefix =
      this.config.get<string>('DOMAIN_EVENTS_MQTT_TOPIC_PREFIX')?.trim() ||
      DOMAIN_EVENT_TOPIC_PREFIX;
    if (prefix === DOMAIN_EVENT_TOPIC_PREFIX) {
      return domainEventTopicFor(type);
    }
    return `${prefix.replace(/\/+$/, '')}/${type}`;
  }

  private async enqueue(
    envelope: DomainEventEnvelope,
    topic: string,
  ): Promise<void> {
    if (!this.queue) return;
    const opts: JobsOptions = {
      jobId: envelope.id,
      attempts: parsePositiveInt(
        this.config.get<string>('DOMAIN_EVENTS_QUEUE_ATTEMPTS'),
        4,
      ),
      backoff: {
        type: 'exponential',
        delay: parsePositiveInt(
          this.config.get<string>('DOMAIN_EVENTS_QUEUE_BACKOFF_MS'),
          750,
        ),
      },
      removeOnComplete: parsePositiveInt(
        this.config.get<string>('DOMAIN_EVENTS_QUEUE_KEEP_COMPLETED'),
        2000,
      ),
      removeOnFail: parsePositiveInt(
        this.config.get<string>('DOMAIN_EVENTS_QUEUE_KEEP_FAILED'),
        5000,
      ),
    };
    await this.queue.add(
      `domain:${envelope.type}`,
      { envelope, topic },
      opts,
    );
  }

  private async publishEnvelopeToMqtt(
    envelope: DomainEventEnvelope,
    topic: string,
    source: 'worker' | 'direct' | 'fallback',
  ): Promise<void> {
    const infra = await this.readInfraSettings();
    if (!infra.mqBrokerEnabled) {
      this.logger.debug(
        `Domain events MQTT skipped (infra toggle) id=${envelope.id}`,
      );
      return;
    }
    if (!this.mqttClient || !this.mqttConnected) {
      throw new Error('mqtt_not_connected');
    }
    const qosRaw = Number(this.config.get<string>('MQTT_QOS') ?? '1');
    const qos = qosRaw === 2 ? 2 : qosRaw === 0 ? 0 : 1;
    const body = JSON.stringify(envelope);
    await new Promise<void>((resolve, reject) => {
      this.mqttClient!.publish(topic, body, { qos, retain: false }, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    this.logger.log(
      `Domain event published via MQTT (${source}) type=${envelope.type} id=${envelope.id} topic=${topic}`,
    );
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

  private initMqttClient(): void {
    const cfg = this.mqttConfig();
    if (!cfg) {
      this.logger.log('Domain events MQTT disabled (MQTT_BROKER_* absent)');
      return;
    }
    const client = mqttConnect(cfg.url, cfg.options);
    client.on('connect', () => {
      this.mqttConnected = true;
      this.logger.log(`Domain events MQTT connected: ${cfg.url}`);
    });
    client.on('reconnect', () => {
      this.logger.warn('Domain events MQTT reconnecting...');
    });
    client.on('error', (error) => {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Domain events MQTT error: ${msg}`);
      if (isMqttAuthError(msg)) {
        this.logger.warn(
          'Domain events MQTT auth rejected; stopping reconnect until restart.',
        );
        this.mqttConnected = false;
        client.end(true);
      }
    });
    client.on('close', () => {
      this.mqttConnected = false;
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
}
