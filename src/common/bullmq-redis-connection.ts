import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const logger = new Logger('BullmqRedis');

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

/** BullMQ interdit les « : » dans les identifiants de job personnalisés. */
export function bullmqJobId(...parts: Array<string | number>): string {
  return parts.map((part) => String(part).replace(/:/g, '-')).join('-');
}

function toBool(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export type BullmqRedisConnection = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: Record<string, unknown>;
};

export function formatBullmqRedisTarget(
  connection: BullmqRedisConnection,
): string {
  const tls = connection.tls ? ' (TLS)' : '';
  return `${connection.host}:${connection.port}${tls}`;
}

type RedisEnvGetter = (key: string) => string | undefined;

function readBullmqRedisConnectionFromGetter(
  get: RedisEnvGetter,
): BullmqRedisConnection | null {
  const redisUrl = get('REDIS_URL')?.trim();
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
          parsed.protocol === 'rediss:' || toBool(get('REDIS_TLS'))
            ? {}
            : undefined,
      };
    } catch {
      logger.warn('Invalid REDIS_URL — BullMQ disabled');
      return null;
    }
  }

  const host = get('REDIS_HOST')?.trim();
  if (!host) return null;
  return {
    host,
    port: parsePositiveInt(get('REDIS_PORT'), 6379),
    username: get('REDIS_USERNAME')?.trim() || undefined,
    password: get('REDIS_PASSWORD')?.trim() || undefined,
    tls: toBool(get('REDIS_TLS')) ? {} : undefined,
  };
}

/** Connexion Redis partagée pour les files BullMQ (process.env). */
export function readBullmqRedisConnection(
  env: NodeJS.ProcessEnv = process.env,
): BullmqRedisConnection | null {
  return readBullmqRedisConnectionFromGetter((key) => env[key]);
}

/** Connexion Redis BullMQ via Nest `ConfigService` (.env chargé par ConfigModule). */
export function readBullmqRedisConnectionFromConfig(
  config: ConfigService,
): BullmqRedisConnection | null {
  return readBullmqRedisConnectionFromGetter((key) =>
    config.get<string>(key),
  );
}
