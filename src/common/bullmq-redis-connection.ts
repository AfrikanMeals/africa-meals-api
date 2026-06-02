import { Logger } from '@nestjs/common';

const logger = new Logger('BullmqRedis');

export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
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

/** Connexion Redis partagée pour les files BullMQ (ws-notify, ads-notify, …). */
export function readBullmqRedisConnection(
  env: NodeJS.ProcessEnv = process.env,
): BullmqRedisConnection | null {
  const redisUrl = env.REDIS_URL?.trim();
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
          parsed.protocol === 'rediss:' || toBool(env.REDIS_TLS) ? {} : undefined,
      };
    } catch {
      logger.warn('Invalid REDIS_URL — BullMQ disabled');
      return null;
    }
  }

  const host = env.REDIS_HOST?.trim();
  if (!host) return null;
  return {
    host,
    port: parsePositiveInt(env.REDIS_PORT, 6379),
    username: env.REDIS_USERNAME?.trim() || undefined,
    password: env.REDIS_PASSWORD?.trim() || undefined,
    tls: toBool(env.REDIS_TLS) ? {} : undefined,
  };
}
