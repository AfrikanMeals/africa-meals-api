import {
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
import {
  parseGraphSyncQueueName,
  shouldEnqueueGraphSync,
} from '@modules/graphdb-settings/graph-config.util';
import { JobsOptions, Queue, Worker } from 'bullmq';
import { GraphSyncService } from './graph-sync.service';
import {
  GRAPH_JOB_ORDER_COMPLETED,
  GRAPH_JOB_RECOMPUTE_STORE_SIMILARITY,
  GRAPH_JOB_SIGNAL_TRACKED,
  GRAPH_JOB_STORE_SUBSCRIBED,
  type GraphOrderCompletedPayload,
  type GraphSignalTrackedPayload,
  type GraphStoreSimilarityPayload,
  type GraphStoreSubscribedPayload,
} from './graph-sync.types';

type GraphJobPayload =
  | GraphOrderCompletedPayload
  | GraphSignalTrackedPayload
  | GraphStoreSubscribedPayload
  | GraphStoreSimilarityPayload;

@Injectable()
export class GraphSyncQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GraphSyncQueueService.name);
  private queue: Queue<GraphJobPayload> | null = null;
  private worker: Worker<GraphJobPayload, void> | null = null;
  private enabled = false;

  constructor(
    private readonly config: ConfigService,
    private readonly bullRedis: BullmqRedisConnectionsService,
    private readonly sync: GraphSyncService,
  ) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  async onModuleInit(): Promise<void> {
    if (!this.bullRedis.isEnabled()) {
      logBullmqDisabledReason();
      this.logger.log('graph-sync — BullMQ off (sync sync/direct if flagged)');
      return;
    }

    const queueName =
      this.config.get<string>('GRAPH_SYNC_QUEUE')?.trim() ||
      parseGraphSyncQueueName();
    const concurrency = parsePositiveInt(
      this.config.get<string>('GRAPH_SYNC_CONCURRENCY'),
      2,
    );

    this.queue = new Queue(queueName, this.bullRedis.queueOpts());
    this.worker = new Worker<GraphJobPayload, void>(
      queueName,
      async (job) => {
        if (!shouldEnqueueGraphSync()) {
          return;
        }
        switch (job.name) {
          case GRAPH_JOB_ORDER_COMPLETED:
            await this.sync.applyOrderCompleted(
              job.data as GraphOrderCompletedPayload,
            );
            break;
          case GRAPH_JOB_SIGNAL_TRACKED:
            await this.sync.applySignalTracked(
              job.data as GraphSignalTrackedPayload,
            );
            break;
          case GRAPH_JOB_STORE_SUBSCRIBED:
            await this.sync.applyStoreSubscribed(
              job.data as GraphStoreSubscribedPayload,
            );
            break;
          case GRAPH_JOB_RECOMPUTE_STORE_SIMILARITY:
            await this.sync.recomputeStoreSimilarity(
              job.data as GraphStoreSimilarityPayload,
            );
            break;
          default:
            break;
        }
      },
      this.bullRedis.workerOpts('graph-sync', { concurrency }),
    );

    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        `graph-sync failed name=${job?.name} id=${job?.id ?? '?'}: ${err.message}`,
      );
    });

    this.enabled = true;
    this.logger.log(
      `BullMQ graph-sync enabled: ${queueName} (concurrency×${concurrency})`,
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
      removeOnComplete: 200,
      removeOnFail: 500,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    };
  }

  /** Enqueue (ou exécution sync) — no-op si GRAPH_SYNC off. */
  async enqueueOrderCompleted(
    payload: GraphOrderCompletedPayload,
  ): Promise<void> {
    if (!shouldEnqueueGraphSync()) return;
    await this.addOrRun(
      GRAPH_JOB_ORDER_COMPLETED,
      payload,
      bullmqJobId('g-ord', payload.orderId),
    );
  }

  async enqueueSignalTracked(
    payload: GraphSignalTrackedPayload,
  ): Promise<void> {
    if (!shouldEnqueueGraphSync()) return;
    await this.addOrRun(
      GRAPH_JOB_SIGNAL_TRACKED,
      payload,
      bullmqJobId(
        'g-sig',
        payload.userId,
        payload.kind,
        payload.refId,
        payload.at.slice(0, 16),
      ),
    );
  }

  async enqueueStoreSubscribed(
    payload: GraphStoreSubscribedPayload,
  ): Promise<void> {
    if (!shouldEnqueueGraphSync()) return;
    await this.addOrRun(
      GRAPH_JOB_STORE_SUBSCRIBED,
      payload,
      bullmqJobId('g-sub', payload.userId, payload.storeId),
    );
  }

  async enqueueStoreSimilarityRecompute(
    payload: GraphStoreSimilarityPayload = {},
  ): Promise<void> {
    if (!shouldEnqueueGraphSync()) return;
    await this.addOrRun(
      GRAPH_JOB_RECOMPUTE_STORE_SIMILARITY,
      payload,
      bullmqJobId('g-sim', Date.now().toString().slice(0, -5)),
    );
  }

  private async addOrRun(
    name: string,
    data: GraphJobPayload,
    jobId: string,
  ): Promise<void> {
    if (!this.queue) {
      await this.runDirect(name, data);
      return;
    }
    try {
      await this.queue.add(name, data, {
        ...this.defaultJobOpts(),
        jobId,
      });
    } catch (err) {
      this.logger.warn(
        `graph-sync enqueue ${name} failed: ${
          err instanceof Error ? err.message : String(err)
        } — fallback direct`,
      );
      await this.runDirect(name, data);
    }
  }

  private async runDirect(name: string, data: GraphJobPayload): Promise<void> {
    try {
      switch (name) {
        case GRAPH_JOB_ORDER_COMPLETED:
          await this.sync.applyOrderCompleted(
            data as GraphOrderCompletedPayload,
          );
          break;
        case GRAPH_JOB_SIGNAL_TRACKED:
          await this.sync.applySignalTracked(data as GraphSignalTrackedPayload);
          break;
        case GRAPH_JOB_STORE_SUBSCRIBED:
          await this.sync.applyStoreSubscribed(
            data as GraphStoreSubscribedPayload,
          );
          break;
        case GRAPH_JOB_RECOMPUTE_STORE_SIMILARITY:
          await this.sync.recomputeStoreSimilarity(
            data as GraphStoreSimilarityPayload,
          );
          break;
        default:
          break;
      }
    } catch (err) {
      this.logger.warn(
        `graph-sync direct ${name}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
