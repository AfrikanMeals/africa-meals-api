import {
  Global,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  attachRedisErrorLogging,
  duplicateBullmqConnection,
  formatBullmqRedisTarget,
  logBullmqDisabledReason,
  parsePositiveInt,
} from '../bullmq-redis-connection';
import {
  connectIoredisWithFailover,
  formatRedisTarget,
  listBullmqRedisWriteConnectionsFromConfig,
  redisConnectionEquals,
} from './redis-connection.util';

/** Une paire de connexions ioredis partagée par toutes les queues BullMQ (évite la tempête TLS au boot). */
@Injectable()
export class BullmqRedisConnectionsService implements OnModuleDestroy {
  private readonly logger = new Logger(BullmqRedisConnectionsService.name);
  private queueConnection: Redis | null = null;
  private prefix?: string;
  private readonly workerConnections: Redis[] = [];
  private connectPromise: Promise<boolean> | null = null;

  constructor(private readonly config: ConfigService) {
    void this.ensureConnected();
  }

  async ensureConnected(): Promise<boolean> {
    if (this.queueConnection?.status === 'ready') return true;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = (async () => {
      const candidates = listBullmqRedisWriteConnectionsFromConfig(this.config);
      if (!candidates.length) {
        logBullmqDisabledReason();
        return false;
      }
      if (this.queueConnection) {
        try {
          await this.queueConnection.quit();
        } catch {
          this.queueConnection.disconnect();
        }
        this.queueConnection = null;
      }
      const timeout = parsePositiveInt(
        this.config.get('REDIS_CONNECT_TIMEOUT_MS'),
        15_000,
      );
      try {
        const result = await connectIoredisWithFailover(candidates, {
          maxRetriesPerRequest: null,
          connectTimeout: timeout,
          enableReadyCheck: false,
          lazyConnect: true,
          writeOnly: true,
        });
        if (!result) {
          this.logger.warn(
            `BullMQ Redis connect failed (${candidates.map(formatRedisTarget).join(' → ')})`,
          );
          return false;
        }
        this.queueConnection = result.client;
        attachRedisErrorLogging(this.queueConnection, 'bullmq');
        this.prefix =
          this.config.get<string>('BULLMQ_PREFIX')?.trim() || undefined;
        const primary = candidates[0];
        const role =
          primary && redisConnectionEquals(result.connection, primary)
            ? 'primary'
            : 'unexpected target';
        this.logger.log(
          `BullMQ Redis connected (${formatBullmqRedisTarget(result.connection)}, ${role})`,
        );
        return true;
      } catch (err) {
        this.logger.warn(
          `BullMQ Redis connect failed: ${(err as Error).message}`,
        );
        return false;
      } finally {
        this.connectPromise = null;
      }
    })();

    return this.connectPromise;
  }

  isEnabled(): boolean {
    return this.queueConnection != null;
  }

  queueOpts(): { connection: Redis; prefix?: string } {
    if (!this.queueConnection) {
      throw new Error('BullMQ Redis disabled (BULLMQ_REDIS_* / REDIS_* absent)');
    }
    return this.prefix
      ? { connection: this.queueConnection, prefix: this.prefix }
      : { connection: this.queueConnection };
  }

  workerOpts(
    label: string,
    extra?: Record<string, unknown>,
  ): { connection: Redis; prefix?: string } & Record<string, unknown> {
    if (!this.queueConnection) {
      throw new Error('BullMQ Redis disabled (BULLMQ_REDIS_* / REDIS_* absent)');
    }
    const workerConnection = duplicateBullmqConnection(
      this.queueConnection,
      label,
    );
    this.workerConnections.push(workerConnection);
    return {
      connection: workerConnection,
      ...(this.prefix ? { prefix: this.prefix } : {}),
      ...extra,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      this.workerConnections.map((client) =>
        client.quit().catch(() => client.disconnect()),
      ),
    );
    this.workerConnections.length = 0;
    if (this.queueConnection) {
      await this.queueConnection.quit().catch(() => {
        this.queueConnection?.disconnect();
      });
      this.queueConnection = null;
    }
  }
}

@Global()
@Module({
  providers: [BullmqRedisConnectionsService],
  exports: [BullmqRedisConnectionsService],
})
export class BullmqRedisModule {}
