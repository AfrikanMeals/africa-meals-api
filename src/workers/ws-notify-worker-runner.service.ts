import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import {
  logBullmqDisabledReason,
  parsePositiveInt,
} from '../common/bullmq-redis-connection';
import { BullmqRedisConnectionsService } from '../common/redis/bullmq-redis-connections.service';

type WsNotifyQueueJob = {
  pathSuffix: string;
  payload: Record<string, unknown>;
};

@Injectable()
export class WsNotifyWorkerRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WsNotifyWorkerRunnerService.name);
  private worker: Worker<WsNotifyQueueJob, void> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly bullRedis: BullmqRedisConnectionsService,
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
    const wsBase =
      this.config.get<string>('AFRICA_MEALS_WS_INTERNAL_URL')?.trim() ||
      'http://localhost:8000';
    const secret =
      this.config.get<string>('INTERNAL_NOTIFY_SECRET')?.trim() ||
      this.config.get<string>('INTERNAL_WS_NOTIFY_SECRET')?.trim() ||
      '';

    this.worker = new Worker<WsNotifyQueueJob, void>(
      queueName,
      async (job) => {
        if (!secret) throw new Error('INTERNAL_NOTIFY_SECRET absent');
        const base = wsBase.replace(/\/+$/, '');
        const path = job.data.pathSuffix.replace(/^\/+/, '');
        const url = base.endsWith('/api')
          ? `${base}/internal/${path}`
          : `${base}/api/internal/${path}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Secret': secret,
          },
          body: JSON.stringify(job.data.payload ?? {}),
        });
        if (!res.ok) {
          throw new Error(`ws_notify_http_${res.status}`);
        }
      },
      this.bullRedis.workerOpts('ws-notify-external', { concurrency }),
    );
    this.worker.on('failed', (job, error) => {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`ws-notify external worker failed job=${job?.id}: ${msg}`);
    });
    this.logger.log(`External ws-notify worker listening on queue ${queueName}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    this.worker = null;
  }
}
