import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parsePositiveInt,
  bullmqJobId,
  readBullmqRedisConnectionFromConfig,
} from '../../common/bullmq-redis-connection';
import { randomUUID } from 'crypto';
import { JobsOptions, Queue, Worker } from 'bullmq';
import { AdNotificationService } from './ad-notification.service';
import type {
  AdNotifyEntityJob,
  AdNotifyRecipientBatchJob,
} from './ad-notification-dispatch.types';

const JOB_ENTITY = 'entity';
const JOB_RECIPIENT_BATCH = 'recipient-batch';

@Injectable()
export class AdNotificationDispatchQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AdNotificationDispatchQueueService.name);
  private queue: Queue<AdNotifyEntityJob | AdNotifyRecipientBatchJob> | null =
    null;
  private entityWorker: Worker<AdNotifyEntityJob, void> | null = null;
  private batchWorker: Worker<AdNotifyRecipientBatchJob, void> | null = null;
  private enabled = false;

  constructor(
    private readonly config: ConfigService,
    @Inject(forwardRef(() => AdNotificationService))
    private readonly adNotifications: AdNotificationService,
  ) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  async onModuleInit(): Promise<void> {
    const connection = readBullmqRedisConnectionFromConfig(this.config);
    if (!connection) {
      this.logger.log(
        'BullMQ ads-notify disabled (REDIS_* absent) — mode synchrone',
      );
      return;
    }

    const queueName =
      this.config.get<string>('AD_NOTIFICATION_QUEUE_NAME')?.trim() ||
      'ads-notify';
    const entityConcurrency = parsePositiveInt(
      this.config.get<string>('AD_NOTIFICATION_ENTITY_CONCURRENCY'),
      2,
    );
    const batchConcurrency = parsePositiveInt(
      this.config.get<string>('AD_NOTIFICATION_BATCH_CONCURRENCY'),
      8,
    );

    this.queue = new Queue(queueName, { connection });

    this.entityWorker = new Worker<AdNotifyEntityJob, void>(
      queueName,
      async (job) => {
        if (job.name !== JOB_ENTITY) return;
        await this.adNotifications.processEntityDispatchJob(job.data);
      },
      { connection, concurrency: entityConcurrency },
    );

    this.batchWorker = new Worker<AdNotifyRecipientBatchJob, void>(
      queueName,
      async (job) => {
        if (job.name !== JOB_RECIPIENT_BATCH) return;
        await this.adNotifications.processRecipientBatchJob(job.data);
      },
      { connection, concurrency: batchConcurrency },
    );

    const onFailed = (label: string) => (job: { id?: string } | undefined, err: Error) => {
      this.logger.warn(
        `ads-notify ${label} failed id=${job?.id ?? '?'}: ${err.message}`,
      );
    };
    this.entityWorker.on('failed', onFailed('entity'));
    this.batchWorker.on('failed', onFailed('batch'));
    const onRedisError = (err: Error) => {
      this.logger.warn(`BullMQ Redis error: ${err.message}`);
    };
    this.queue.on('error', onRedisError);
    this.entityWorker.on('error', onRedisError);
    this.batchWorker.on('error', onRedisError);

    this.enabled = true;
    this.logger.log(
      `BullMQ ads-notify enabled: ${queueName} (entity×${entityConcurrency}, batch×${batchConcurrency})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.entityWorker?.close();
    await this.batchWorker?.close();
    await this.queue?.close();
    this.entityWorker = null;
    this.batchWorker = null;
    this.queue = null;
    this.enabled = false;
  }

  private defaultJobOpts(): JobsOptions {
    return {
      removeOnComplete: 200,
      removeOnFail: 500,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    };
  }

  /** Cron léger : enqueue uniquement les entités en attente. */
  async enqueuePendingDispatches(): Promise<{
    bannersDispatched: number;
    campaignsDispatched: number;
  }> {
    if (!this.queue) {
      return this.adNotifications.runDispatchPassSync();
    }
    return this.adNotifications.enqueuePendingEntities(this.queue, {
      entityJobName: JOB_ENTITY,
      batchJobName: JOB_RECIPIENT_BATCH,
      jobOpts: this.defaultJobOpts(),
    });
  }

  /** Enqueue (ou exécution sync) d’une bannière / campagne éligible. */
  async enqueueEntityDispatch(job: AdNotifyEntityJob): Promise<void> {
    if (!this.queue) {
      await this.adNotifications.processEntityDispatchJob(job);
      return;
    }
    await this.queue.add(JOB_ENTITY, job, {
      ...this.defaultJobOpts(),
      jobId: bullmqJobId(job.kind, job.entityId),
    });
  }

  async enqueueRecipientBatch(
    payload: AdNotifyRecipientBatchJob,
  ): Promise<void> {
    if (!this.queue) {
      await this.adNotifications.processRecipientBatchJob(payload);
      return;
    }
    await this.queue.add(JOB_RECIPIENT_BATCH, payload, {
      ...this.defaultJobOpts(),
      jobId: bullmqJobId(
        'batch',
        payload.entityType,
        payload.entityId,
        randomUUID(),
      ),
    });
  }
}
