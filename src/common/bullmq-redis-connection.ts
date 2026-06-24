import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  formatRedisTarget,
  parsePositiveInt,
  readBullmqRedisConnectionFromConfig,
  readBullmqRedisConnectionFromEnv,
  readBullmqRedisConnectionFromGetter,
  type RedisConnectionConfig,
} from './redis/redis-connection.util';

const logger = new Logger('BullmqRedis');

export type BullmqRedisConnection = RedisConnectionConfig;

export { parsePositiveInt, readBullmqRedisConnectionFromConfig, readBullmqRedisConnectionFromEnv };

export function formatBullmqRedisTarget(
  connection: BullmqRedisConnection,
): string {
  return formatRedisTarget(connection);
}

/** BullMQ interdit les « : » dans les identifiants de job personnalisés. */
export function bullmqJobId(...parts: Array<string | number>): string {
  return parts.map((part) => String(part).replace(/:/g, '-')).join('-');
}

export type BullmqQueueBaseOptions = {
  connection: BullmqRedisConnection;
  prefix?: string;
};

/** Options communes Queue/Worker BullMQ (connexion dédiée + prefix cluster). */
export function readBullmqQueueBaseOptionsFromConfig(
  config: ConfigService,
): BullmqQueueBaseOptions | null {
  const connection = readBullmqRedisConnectionFromConfig(config);
  if (!connection) {
    return null;
  }
  const prefix = config.get<string>('BULLMQ_PREFIX')?.trim();
  if (prefix) {
    return { connection, prefix };
  }
  return { connection };
}

export function readBullmqQueueBaseOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BullmqQueueBaseOptions | null {
  const connection = readBullmqRedisConnectionFromEnv(env);
  if (!connection) {
    return null;
  }
  const prefix = env.BULLMQ_PREFIX?.trim();
  if (prefix) {
    return { connection, prefix };
  }
  return { connection };
}

export function logBullmqDisabledReason(): void {
  logger.log(
    'BullMQ disabled (BULLMQ_REDIS_* / REDIS_* absent) -> direct / sync mode',
  );
}

export { readBullmqRedisConnectionFromGetter };
