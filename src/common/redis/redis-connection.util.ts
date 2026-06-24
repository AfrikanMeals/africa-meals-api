import { ConfigService } from '@nestjs/config';

export function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function toBool(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export type RedisConnectionConfig = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: Record<string, unknown>;
};

type RedisEnvGetter = (key: string) => string | undefined;

type RedisEnvKeySet = {
  url: string;
  host: string;
  port: string;
  username: string;
  password: string;
  tls: string;
  tlsRejectUnauthorized: string;
};

const CACHE_REDIS_KEYS: RedisEnvKeySet = {
  url: 'REDIS_URL',
  host: 'REDIS_HOST',
  port: 'REDIS_PORT',
  username: 'REDIS_USERNAME',
  password: 'REDIS_PASSWORD',
  tls: 'REDIS_TLS',
  tlsRejectUnauthorized: 'REDIS_TLS_REJECT_UNAUTHORIZED',
};

const BULLMQ_REDIS_KEYS: RedisEnvKeySet = {
  url: 'BULLMQ_REDIS_URL',
  host: 'BULLMQ_REDIS_HOST',
  port: 'BULLMQ_REDIS_PORT',
  username: 'BULLMQ_REDIS_USERNAME',
  password: 'BULLMQ_REDIS_PASSWORD',
  tls: 'BULLMQ_REDIS_TLS',
  tlsRejectUnauthorized: 'BULLMQ_REDIS_TLS_REJECT_UNAUTHORIZED',
};

/** Options TLS ioredis / node-redis — cert Stunnel auto-signé : `*_TLS_REJECT_UNAUTHORIZED=false`. */
function buildTlsOptions(
  get: RedisEnvGetter,
  keys: RedisEnvKeySet,
  tlsFromUrl: boolean,
): Record<string, unknown> | undefined {
  const enabled = tlsFromUrl || toBool(get(keys.tls));
  if (!enabled) return undefined;
  const rejectRaw = get(keys.tlsRejectUnauthorized)?.trim().toLowerCase();
  if (
    rejectRaw === 'false' ||
    rejectRaw === '0' ||
    rejectRaw === 'no' ||
    rejectRaw === 'off'
  ) {
    return { rejectUnauthorized: false };
  }
  return {};
}

function enrichTlsSni(connection: RedisConnectionConfig): RedisConnectionConfig {
  if (!connection.tls) return connection;
  return {
    ...connection,
    tls: { ...connection.tls, servername: connection.host },
  };
}

function readRedisConnectionWithKeys(
  get: RedisEnvGetter,
  keys: RedisEnvKeySet,
): RedisConnectionConfig | null {
  const redisUrl = get(keys.url)?.trim();
  if (redisUrl) {
    try {
      const parsed = new URL(redisUrl);
      return enrichTlsSni({
        host: parsed.hostname,
        port: parsePositiveInt(
          parsed.port,
          parsed.protocol === 'rediss:' ? 6380 : 6379,
        ),
        username: parsed.username || undefined,
        password: parsed.password || undefined,
        tls: buildTlsOptions(get, keys, parsed.protocol === 'rediss:'),
      });
    } catch {
      return null;
    }
  }

  const host = get(keys.host)?.trim();
  if (!host) return null;
  return enrichTlsSni({
    host,
    port: parsePositiveInt(get(keys.port), 6379),
    username: get(keys.username)?.trim() || undefined,
    password: get(keys.password)?.trim() || undefined,
    tls: buildTlsOptions(get, keys, false),
  });
}

/** Cache HTTP, pub/sub SSE, tokens partagés — `REDIS_*`. */
export function readRedisConnectionFromGetter(
  get: RedisEnvGetter,
): RedisConnectionConfig | null {
  return readRedisConnectionWithKeys(get, CACHE_REDIS_KEYS);
}

export function readRedisConnectionFromConfig(
  config: ConfigService | { get: (key: string) => string | undefined },
): RedisConnectionConfig | null {
  return readRedisConnectionFromGetter((key) => config.get(key));
}

export function readRedisConnectionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RedisConnectionConfig | null {
  return readRedisConnectionFromGetter((key) => env[key]);
}

/** Instance dédiée BullMQ — `BULLMQ_REDIS_*`, repli sur `REDIS_*` si absent. */
export function readBullmqRedisConnectionFromGetter(
  get: RedisEnvGetter,
): RedisConnectionConfig | null {
  return (
    readRedisConnectionWithKeys(get, BULLMQ_REDIS_KEYS) ??
    readRedisConnectionWithKeys(get, CACHE_REDIS_KEYS)
  );
}

export function readBullmqRedisConnectionFromConfig(
  config: ConfigService | { get: (key: string) => string | undefined },
): RedisConnectionConfig | null {
  return readBullmqRedisConnectionFromGetter((key) => config.get(key));
}

export function readBullmqRedisConnectionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): RedisConnectionConfig | null {
  return readBullmqRedisConnectionFromGetter((key) => env[key]);
}

export function formatRedisTarget(connection: RedisConnectionConfig): string {
  const tls = connection.tls ? ' (TLS)' : '';
  return `${connection.host}:${connection.port}${tls}`;
}

export function buildRedisUrlFromConnection(
  connection: RedisConnectionConfig,
): string {
  const auth =
    connection.password != null && connection.password !== ''
      ? `${encodeURIComponent(connection.username || 'default')}:${encodeURIComponent(connection.password)}@`
      : '';
  const protocol = connection.tls ? 'rediss' : 'redis';
  return `${protocol}://${auth}${connection.host}:${connection.port}`;
}

/** URL pour cache-manager / clients URL-based. */
export function readRedisUrlFromConfig(
  config: ConfigService,
): string | null {
  const direct = config.get<string>('REDIS_URL')?.trim();
  if (direct) return direct;
  const conn = readRedisConnectionFromConfig(config);
  if (!conn) return null;
  return buildRedisUrlFromConnection(conn);
}

/** Options `cache-manager-redis-yet` / node-redis (socket TLS Stunnel Mode A). */
export function readRedisCacheStoreOptionsFromConfig(
  config: ConfigService,
): {
  url: string;
  socket?: {
    tls: true;
    servername?: string;
    rejectUnauthorized?: boolean;
  };
} | null {
  const url = readRedisUrlFromConfig(config);
  if (!url) return null;
  const conn = readRedisConnectionFromConfig(config);
  if (!conn?.tls) return { url };
  const rejectUnauthorized =
    conn.tls.rejectUnauthorized !== false ? undefined : false;
  return {
    url,
    socket: {
      tls: true,
      servername: conn.host,
      ...(rejectUnauthorized === false ? { rejectUnauthorized: false } : {}),
    },
  };
}

/** Options ioredis — TLS Stunnel (`rediss://` ou `REDIS_TLS=true`) + SNI. */
export type IoredisOptions = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  tls?: Record<string, unknown>;
  maxRetriesPerRequest: number | null;
  connectTimeout?: number;
  lazyConnect?: boolean;
  enableReadyCheck?: boolean;
};

export function buildIoredisOptionsFromConnection(
  connection: RedisConnectionConfig,
  overrides?: Partial<IoredisOptions>,
): IoredisOptions {
  return {
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: connection.password,
    tls: connection.tls,
    maxRetriesPerRequest: 2,
    ...overrides,
  };
}

export function readIoredisOptionsFromConfig(
  config: ConfigService | { get: (key: string) => string | undefined },
  overrides?: Partial<IoredisOptions>,
): IoredisOptions | null {
  const connection = readRedisConnectionFromConfig(config);
  if (!connection) return null;
  return buildIoredisOptionsFromConnection(connection, overrides);
}

export function readIoredisOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  overrides?: Partial<IoredisOptions>,
): IoredisOptions | null {
  const connection = readRedisConnectionFromEnv(env);
  if (!connection) return null;
  return buildIoredisOptionsFromConnection(connection, overrides);
}

export function redactRedisUrl(url: string): string {
  return url.replace(/:\/\/[^@]+@/, '://***:***@');
}

export function isBullmqRedisDedicated(config: ConfigService): boolean {
  return (
    Boolean(config.get<string>('BULLMQ_REDIS_URL')?.trim()) ||
    Boolean(config.get<string>('BULLMQ_REDIS_HOST')?.trim())
  );
}
