import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  buildIoredisOptionsFromConnection,
  formatRedisTarget,
  parsePositiveInt,
  readBullmqRedisConnectionFromConfig,
  readBullmqRedisConnectionFromEnv,
  readBullmqRedisConnectionFromGetter,
  redisRetryStrategy,
  type IoredisOptions,
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

function attachRedisErrorLogging(client: Redis, label?: string): void {
  const prefix = label ? `${label}: ` : '';
  let lastResetLogAt = 0;
  client.on('error', (err) => {
    const msg = err.message ?? '';
    if (msg.includes('ECONNRESET')) {
      const now = Date.now();
      if (now - lastResetLogAt < 60_000) return;
      lastResetLogAt = now;
      logger.warn(
        `${prefix}TLS connexion fermée (idle Stunnel) — reconnexion automatique`,
      );
      return;
    }
    logger.warn(`${prefix}${msg}`);
  });
}

export { attachRedisErrorLogging };

export function readBullmqIoredisOptionsFromConfig(
  config: ConfigService | { get: (key: string) => string | undefined },
): IoredisOptions | null {
  const connection = readBullmqRedisConnectionFromConfig(config);
  if (!connection) return null;
  const timeout = parsePositiveInt(
    config.get?.('REDIS_CONNECT_TIMEOUT_MS') ??
      process.env.REDIS_CONNECT_TIMEOUT_MS,
    15_000,
  );
  return buildIoredisOptionsFromConnection(connection, {
    maxRetriesPerRequest: null,
    connectTimeout: timeout,
    retryStrategy: redisRetryStrategy,
    enableReadyCheck: false,
    lazyConnect: true,
  });
}

export type BullmqQueueWorkerConnections = {
  connection: Redis;
  workerConnection: Redis;
  prefix?: string;
};

export function duplicateBullmqConnection(
  source: Redis,
  label?: string,
): Redis {
  const dup = source.duplicate();
  attachRedisErrorLogging(dup, label);
  return dup;
}

export function createBullmqQueueWorkerConnections(
  config: ConfigService,
  label?: string,
): BullmqQueueWorkerConnections | null {
  const opts = readBullmqIoredisOptionsFromConfig(config);
  if (!opts) return null;
  const connection = new Redis(opts);
  const workerConnection = connection.duplicate();
  attachRedisErrorLogging(connection, label);
  attachRedisErrorLogging(workerConnection, label);
  const prefix = config.get<string>('BULLMQ_PREFIX')?.trim();
  return prefix
    ? { connection, workerConnection, prefix }
    : { connection, workerConnection };
}

export async function closeBullmqQueueWorkerConnections(
  conns: BullmqQueueWorkerConnections | null | undefined,
  extra?: Redis[],
): Promise<void> {
  const clients = [
    conns?.connection,
    conns?.workerConnection,
    ...(extra ?? []),
  ].filter(Boolean) as Redis[];
  await Promise.all(
    clients.map((client) =>
      client.quit().catch(() => {
        client.disconnect();
      }),
    ),
  );
}

export function bullmqQueueOpts(conns: BullmqQueueWorkerConnections): {
  connection: Redis;
  prefix?: string;
} {
  return conns.prefix
    ? { connection: conns.connection, prefix: conns.prefix }
    : { connection: conns.connection };
}

export function bullmqWorkerOpts(
  conns: BullmqQueueWorkerConnections,
  extra?: Record<string, unknown>,
): {
  connection: Redis;
  prefix?: string;
} {
  return {
    connection: conns.workerConnection,
    ...(conns.prefix ? { prefix: conns.prefix } : {}),
    ...extra,
  };
}

export type BullmqQueueBaseOptions = BullmqQueueWorkerConnections;

export function readBullmqQueueBaseOptionsFromConfig(
  config: ConfigService,
): BullmqQueueBaseOptions | null {
  return createBullmqQueueWorkerConnections(config);
}

export function readBullmqQueueBaseOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): BullmqQueueBaseOptions | null {
  const connection = readBullmqRedisConnectionFromEnv(env);
  if (!connection) return null;
  const timeout = parsePositiveInt(env.REDIS_CONNECT_TIMEOUT_MS, 15_000);
  const opts = buildIoredisOptionsFromConnection(connection, {
    maxRetriesPerRequest: null,
    connectTimeout: timeout,
    retryStrategy: redisRetryStrategy,
    enableReadyCheck: false,
  });
  const client = new Redis(opts);
  const workerConnection = client.duplicate();
  attachRedisErrorLogging(client);
  attachRedisErrorLogging(workerConnection);
  const prefix = env.BULLMQ_PREFIX?.trim();
  return prefix
    ? { connection: client, workerConnection, prefix }
    : { connection: client, workerConnection };
}

export function logBullmqDisabledReason(): void {
  logger.log(
    'BullMQ disabled (BULLMQ_REDIS_* / REDIS_* absent) -> direct / sync mode',
  );
}

export { readBullmqRedisConnectionFromGetter };
