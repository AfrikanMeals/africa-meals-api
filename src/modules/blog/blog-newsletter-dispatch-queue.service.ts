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
  bullmqJobId,
  logBullmqDisabledReason,
  parsePositiveInt,
  readBullmqQueueBaseOptionsFromConfig,
} from '../../common/bullmq-redis-connection';
import { randomUUID } from 'crypto';
import { JobsOptions, Queue, Worker } from 'bullmq';
import { BlogNewsletterDispatchService } from './blog-newsletter-dispatch.service';
import type { BlogNewsletterBatchJob } from './blog-newsletter-dispatch.types';

const JOB_BATCH = 'recipient-batch';

@Injectable()
export class BlogNewsletterDispatchQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(BlogNewsletterDispatchQueueService.name);
  private queue: Queue<BlogNewsletterBatchJob> | null = null;
  private worker: Worker<BlogNewsletterBatchJob, void> | null = null;
  private enabled = false;

  constructor(
    private readonly config: ConfigService,
    @Inject(forwardRef(() => BlogNewsletterDispatchService))
    private readonly dispatch: BlogNewsletterDispatchService,
  ) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  async onModuleInit(): Promise<void> {
    const queueOpts = readBullmqQueueBaseOptionsFromConfig(this.config);
    if (!queueOpts) {
      logBullmqDisabledReason();
      this.logger.log('blog-newsletter — envoi synchrone par lots');
      return;
    }

    const queueName =
      this.config.get<string>('BLOG_NEWSLETTER_QUEUE_NAME')?.trim() ||
      'blog-newsletter';
    const concurrency = parsePositiveInt(
      this.config.get<string>('BLOG_NEWSLETTER_QUEUE_CONCURRENCY'),
      4,
    );

    this.queue = new Queue(queueName, queueOpts);
    this.worker = new Worker<BlogNewsletterBatchJob, void>(
      queueName,
      async (job) => {
        if (job.name !== JOB_BATCH) return;
        await this.dispatch.processBatchJob(job.data);
      },
      { ...queueOpts, concurrency },
    );

    const onFailed = (job: { id?: string } | undefined, err: Error) => {
      this.logger.warn(
        `blog-newsletter batch failed id=${job?.id ?? '?'}: ${err.message}`,
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
      `BullMQ blog-newsletter enabled: ${queueName} (concurrency×${concurrency})`,
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
    batches: BlogNewsletterBatchJob[],
  ): Promise<{ queued: boolean; batchCount: number }> {
    if (!this.queue) {
      for (const batch of batches) {
        await this.dispatch.processBatchJob(batch);
      }
      return { queued: false, batchCount: batches.length };
    }

    let i = 0;
    for (const batch of batches) {
      await this.queue.add(JOB_BATCH, batch, {
        ...this.defaultJobOpts(),
        jobId: bullmqJobId(batch.campaignId, i, randomUUID()),
      });
      i += 1;
    }
    return { queued: true, batchCount: batches.length };
  }
}
