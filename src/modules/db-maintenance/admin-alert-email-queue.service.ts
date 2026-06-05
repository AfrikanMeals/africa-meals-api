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
  readBullmqRedisConnection,
} from '../../common/bullmq-redis-connection';
import { randomUUID } from 'crypto';
import { JobsOptions, Queue, Worker } from 'bullmq';
import { AdminAlertEmailService } from './admin-alert-email.service';
import type { AdminAlertEmailBatchJob } from './admin-alert-email.types';

const JOB_BATCH = 'recipient-batch';

@Injectable()
export class AdminAlertEmailQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AdminAlertEmailQueueService.name);
  private queue: Queue<AdminAlertEmailBatchJob> | null = null;
  private worker: Worker<AdminAlertEmailBatchJob, void> | null = null;
  private enabled = false;

  constructor(
    private readonly config: ConfigService,
    @Inject(forwardRef(() => AdminAlertEmailService))
    private readonly alertEmail: AdminAlertEmailService,
  ) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  async onModuleInit(): Promise<void> {
    const connection = readBullmqRedisConnection(
      this.config as unknown as NodeJS.ProcessEnv,
    );
    if (!connection) {
      this.logger.log(
        'BullMQ admin-alert-email disabled (REDIS_* absent) — envoi synchrone par lots',
      );
      return;
    }

    const queueName =
      this.config.get<string>('ADMIN_ALERT_EMAIL_QUEUE_NAME')?.trim() ||
      'admin-alert-email';
    const concurrency = parsePositiveInt(
      this.config.get<string>('ADMIN_ALERT_EMAIL_CONCURRENCY'),
      4,
    );

    this.queue = new Queue<AdminAlertEmailBatchJob>(queueName, { connection });
    this.worker = new Worker<AdminAlertEmailBatchJob, void>(
      queueName,
      async (job) => {
        if (job.name !== JOB_BATCH) return;
        await this.alertEmail.processBatchJob(job.data);
      },
      { connection, concurrency },
    );

    const onFailed = (job: { id?: string } | undefined, err: Error) => {
      this.logger.warn(
        `admin-alert-email batch failed id=${job?.id ?? '?'}: ${err.message}`,
      );
    };
    this.worker.on('failed', onFailed);
    const onRedisError = (err: Error) => {
      this.logger.warn(`BullMQ Redis error: ${err.message}`);
    };
    this.queue.on('error', onRedisError);
    this.worker.on('error', onRedisError);

    this.enabled = true;
    this.logger.log(
      `BullMQ admin-alert-email enabled: ${queueName} (concurrency×${concurrency})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.worker = null;
    this.queue = null;
    this.enabled = false;
  }

  private defaultJobOpts(): JobsOptions {
    return {
      removeOnComplete: 100,
      removeOnFail: 200,
      attempts: 3,
      backoff: { type: 'exponential', delay: 3000 },
    };
  }

  async enqueueBatches(
    batches: AdminAlertEmailBatchJob[],
  ): Promise<{ queued: boolean; batchCount: number }> {
    if (!this.queue) {
      for (const batch of batches) {
        await this.alertEmail.processBatchJob(batch);
      }
      return { queued: false, batchCount: batches.length };
    }

    let i = 0;
    for (const batch of batches) {
      await this.queue.add(JOB_BATCH, batch, {
        ...this.defaultJobOpts(),
        jobId: `${batch.campaignId}:${i}:${randomUUID()}`,
      });
      i += 1;
    }
    return { queued: true, batchCount: batches.length };
  }
}
