import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobsOptions, Queue, Worker } from 'bullmq';

type WsNotifyQueueJob = {
  pathSuffix: string;
  payload: Record<string, unknown>;
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function toBool(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

@Injectable()
export class WsNotifyDispatchQueueService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WsNotifyDispatchQueueService.name);
  private queue: Queue<WsNotifyQueueJob> | null = null;
  private worker: Worker<WsNotifyQueueJob, void> | null = null;
  private queueEnabled = false;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
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
    this.queueEnabled = true;
    this.logger.log(`BullMQ queue enabled: ${queueName}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.worker = null;
    this.queue = null;
    this.queueEnabled = false;
  }

  dispatch(pathSuffix: string, payload: Record<string, unknown>): void {
    const suffix = pathSuffix.trim();
    if (!suffix) return;
    const normalizedPayload = { ...payload };
    if (!this.queueEnabled || !this.queue) {
      void this.postInternal(suffix, normalizedPayload).catch((error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`ws notify direct failed (${suffix}): ${msg}`);
      });
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

    void this.queue.add(`notify:${suffix}`, {
      pathSuffix: suffix,
      payload: normalizedPayload,
    }, opts).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`ws notify enqueue failed (${suffix}): ${msg}`);
      void this.postInternal(suffix, normalizedPayload).catch(() => undefined);
    });
  }

  private redisConnectionConfig():
    | {
        host: string;
        port: number;
        username?: string;
        password?: string;
        tls?: Record<string, unknown>;
      }
    | null {
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
}
