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
