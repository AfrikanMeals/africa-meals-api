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
  listBullmqRedisConnectionsFromConfig,
} from './redis-connection.util';

/** Une paire de connexions ioredis partagée par toutes les queues BullMQ (évite la tempête TLS au boot). */
@Injectable()
export class BullmqRedisConnectionsService implements OnModuleDestroy {
  private readonly logger = new Logger(BullmqRedisConnectionsService.name);
  private queueConnection: Redis | null = null;
  private prefix?: string;
  private readonly workerConnections: Redis[] = [];

  constructor(private readonly config: ConfigService) {
    const candidates = listBullmqRedisConnectionsFromConfig(config);
    if (!candidates.length) {
      logBullmqDisabledReason();
      return;
    }
    const timeout = parsePositiveInt(
      config.get('REDIS_CONNECT_TIMEOUT_MS'),
      15_000,
    );
    void connectIoredisWithFailover(candidates, {
      maxRetriesPerRequest: null,
      connectTimeout: timeout,
      enableReadyCheck: false,
      lazyConnect: true,
    }).then((result) => {
      if (!result) {
        this.logger.warn(
          `BullMQ Redis connect failed (${candidates.map(formatRedisTarget).join(' → ')})`,
        );
        return;
      }
      this.queueConnection = result.client;
      attachRedisErrorLogging(this.queueConnection, 'bullmq');
      this.prefix = config.get<string>('BULLMQ_PREFIX')?.trim() || undefined;
      const role =
        result.connection === candidates[0] ? 'primary' : 'replica failover';
      this.logger.log(
        `BullMQ Redis connected (${formatBullmqRedisTarget(result.connection)}, ${role})`,
      );
    });
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
