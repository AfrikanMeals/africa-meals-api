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
} from '../../common/bullmq-redis-connection';
import { BullmqRedisConnectionsService } from '../../common/redis/bullmq-redis-connections.service';
import { JobsOptions, Queue, Worker } from 'bullmq';
import { PlatformPushCampaignsService } from './platform-push-campaigns.service';

const JOB_SEND = 'send';

type CampaignJob = { campaignId: string };

/**
 * File BullMQ des campagnes push Marketing.
 * Sans Redis dédié : `enqueue` retourne false et l’appelant envoie en synchrone.
 */
@Injectable()
export class PlatformPushCampaignQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PlatformPushCampaignQueueService.name);
  private queue: Queue<CampaignJob> | null = null;
  private worker: Worker<CampaignJob, void> | null = null;
  private enabled = false;

  constructor(
    private readonly config: ConfigService,
    private readonly bullRedis: BullmqRedisConnectionsService,
    @Inject(forwardRef(() => PlatformPushCampaignsService))
    private readonly campaigns: PlatformPushCampaignsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.bullRedis.isEnabled()) {
      logBullmqDisabledReason();
      this.logger.log('platform-push-campaigns — envoi synchrone');
      return;
    }

    const queueName =
      this.config.get<string>('PLATFORM_PUSH_CAMPAIGN_QUEUE_NAME')?.trim() ||
      'platform-push-campaigns';
    const concurrency = parsePositiveInt(
      this.config.get<string>('PLATFORM_PUSH_CAMPAIGN_QUEUE_CONCURRENCY'),
      1,
    );

    this.queue = new Queue(queueName, this.bullRedis.queueOpts());
    this.worker = new Worker<CampaignJob, void>(
      queueName,
      async (job) => {
        if (job.name !== JOB_SEND) return;
        await this.campaigns.processCampaignJob(job.data.campaignId);
      },
      this.bullRedis.workerOpts('platform-push-campaigns', { concurrency }),
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        `platform-push-campaign failed id=${job?.id ?? '?'}: ${err.message}`,
      );
    });
    this.enabled = true;
    this.logger.log(
      `BullMQ platform-push-campaigns: ${queueName} (concurrency×${concurrency})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.worker = null;
    this.queue = null;
    this.enabled = false;
  }

  /** true si le job est en file. false = le caller doit envoyer lui-même. */
  async enqueue(campaignId: string): Promise<boolean> {
    if (!this.queue) return false;
    const jobId = bullmqJobId('ppc', campaignId);
    const existing = await this.queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'active' || state === 'waiting' || state === 'delayed') {
        return true;
      }
      await existing.remove().catch(() => undefined);
    }
    await this.queue.add(JOB_SEND, { campaignId }, {
      ...this.jobOpts(),
      jobId,
    });
    return true;
  }

  /** Retire un job pas encore actif (pause ou suppression avant le start). */
  async removeWaiting(campaignId: string): Promise<void> {
    if (!this.queue) return;
    const job = await this.queue.getJob(bullmqJobId('ppc', campaignId));
    if (!job) return;
    const state = await job.getState();
    if (state === 'waiting' || state === 'delayed') {
      await job.remove().catch(() => undefined);
    }
  }

  private jobOpts(): JobsOptions {
    return {
      removeOnComplete: 100,
      removeOnFail: 200,
      attempts: 2,
      backoff: { type: 'exponential', delay: 3000 },
    };
  }
}
