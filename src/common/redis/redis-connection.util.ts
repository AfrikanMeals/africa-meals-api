import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

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

/** Décode user/password issus de `new URL()` (souvent déjà décodés ; no-op si invalide). */
function decodeUriAuth(raw: string | undefined): string {
  const v = (raw ?? '').trim();
  if (!v) return '';
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** 4 ou 6 — utile si l’IPv4 vers le VPS est bloquée (FAI) et seul l’AAAA répond. */
export function readRedisIpFamily(
  get: RedisEnvGetter = (key) => process.env[key],
): 4 | 6 | undefined {
  const raw = get('REDIS_IP_FAMILY')?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (n === 4 || n === 6) return n;
  return undefined;
}

/** TCP keepalive (ms) — évite TIMEOUTidle Stunnel (~120s) sur connexions BullMQ/pub-sub idle. */
export function readRedisTcpKeepAliveMs(
  get: RedisEnvGetter = (key) => process.env[key],
): number {
  return parsePositiveInt(get('REDIS_TCP_KEEPALIVE_MS'), 30_000);
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
  tlsServername: string;
};

const CACHE_REDIS_KEYS: RedisEnvKeySet = {
  url: 'REDIS_URL',
  host: 'REDIS_HOST',
  port: 'REDIS_PORT',
  username: 'REDIS_USERNAME',
  password: 'REDIS_PASSWORD',
  tls: 'REDIS_TLS',
  tlsRejectUnauthorized: 'REDIS_TLS_REJECT_UNAUTHORIZED',
  tlsServername: 'REDIS_TLS_SERVERNAME',
};

const BULLMQ_REDIS_KEYS: RedisEnvKeySet = {
  url: 'BULLMQ_REDIS_URL',
  host: 'BULLMQ_REDIS_HOST',
  port: 'BULLMQ_REDIS_PORT',
  username: 'BULLMQ_REDIS_USERNAME',
  password: 'BULLMQ_REDIS_PASSWORD',
  tls: 'BULLMQ_REDIS_TLS',
  tlsRejectUnauthorized: 'BULLMQ_REDIS_TLS_REJECT_UNAUTHORIZED',
  tlsServername: 'BULLMQ_REDIS_TLS_SERVERNAME',
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

function enrichTlsSni(
  connection: RedisConnectionConfig,
  get: RedisEnvGetter,
  keys: RedisEnvKeySet,
): RedisConnectionConfig {
  if (!connection.tls) return connection;
  const servername = get(keys.tlsServername)?.trim() || connection.host;
  return {
    ...connection,
    tls: { ...connection.tls, servername },
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
      const conn = {
        host: parsed.hostname,
        port: parsePositiveInt(
          parsed.port,
          parsed.protocol === 'rediss:' ? 6380 : 6379,
        ),
        // URL d’abord ; REDIS_USERNAME / REDIS_PASSWORD en secours si absents de l’URL.
        username:
          decodeUriAuth(parsed.username) ||
          get(keys.username)?.trim() ||
          undefined,
        password:
          decodeUriAuth(parsed.password) ||
          get(keys.password)?.trim() ||
          undefined,
        tls: buildTlsOptions(get, keys, parsed.protocol === 'rediss:'),
      };
      return enrichTlsSni(conn, get, keys);
    } catch {
      return null;
    }
  }

  const host = get(keys.host)?.trim();
  if (!host) return null;
  const conn = {
    host,
    port: parsePositiveInt(get(keys.port), 6379),
    username: get(keys.username)?.trim() || undefined,
    password: get(keys.password)?.trim() || undefined,
    tls: buildTlsOptions(get, keys, false),
  };
  return enrichTlsSni(conn, get, keys);
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

function readRedisConnectionFromUrlString(
  redisUrl: string,
  get: RedisEnvGetter,
  keys: RedisEnvKeySet,
): RedisConnectionConfig | null {
  try {
    const parsed = new URL(redisUrl);
    const conn = {
      host: parsed.hostname,
      port: parsePositiveInt(
        parsed.port,
        parsed.protocol === 'rediss:' ? 6380 : 6379,
      ),
      username: decodeUriAuth(parsed.username) || undefined,
      password: decodeUriAuth(parsed.password) || undefined,
      tls: buildTlsOptions(get, keys, parsed.protocol === 'rediss:'),
    };
    return enrichTlsSni(conn, get, keys);
  } catch {
    return null;
  }
}

/** Réplicas `REDIS_REPLICA_N_URL` ou `REDIS_REPLICA_N_PORT` (même hôte/credentials que le primary). */
function readRedisReplicasWithKeys(
  get: RedisEnvGetter,
  keys: RedisEnvKeySet,
  envPrefix: string,
  primary: RedisConnectionConfig,
): RedisConnectionConfig[] {
  const replicas: RedisConnectionConfig[] = [];
  for (const n of [1, 2] as const) {
    const url = get(`${envPrefix}_${n}_URL`)?.trim();
    if (url) {
      const conn = readRedisConnectionFromUrlString(url, get, keys);
      if (conn) replicas.push(conn);
      continue;
    }
    const portRaw = get(`${envPrefix}_${n}_PORT`)?.trim();
    if (portRaw) {
      replicas.push({
        ...primary,
        port: parsePositiveInt(portRaw, primary.port),
      });
    }
  }
  return replicas;
}

/** Primary + réplicas — lectures / failover read-only (pas BullMQ ni SSE publish). */
export function listRedisCacheConnectionsFromGetter(
  get: RedisEnvGetter,
): RedisConnectionConfig[] {
  const primary = readRedisConnectionWithKeys(get, CACHE_REDIS_KEYS);
  if (!primary) return [];
  return [
    primary,
    ...readRedisReplicasWithKeys(get, CACHE_REDIS_KEYS, 'REDIS_REPLICA', primary),
  ];
}

export function listRedisCacheConnectionsFromConfig(
  config: ConfigService | { get: (key: string) => string | undefined },
): RedisConnectionConfig[] {
  return listRedisCacheConnectionsFromGetter((key) => config.get(key));
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

/** @deprecated Préférer `listBullmqRedisWriteConnectionsFromConfig` — les réplicas sont READONLY. */
export function listBullmqRedisConnectionsFromGetter(
  get: RedisEnvGetter,
): RedisConnectionConfig[] {
  return listBullmqRedisWriteConnectionsFromGetter(get);
}

export function listBullmqRedisConnectionsFromConfig(
  config: ConfigService | { get: (key: string) => string | undefined },
): RedisConnectionConfig[] {
  return listBullmqRedisConnectionsFromGetter((key) => config.get(key));
}

export function formatRedisTarget(connection: RedisConnectionConfig): string {
  const tls = connection.tls ? ' (TLS)' : '';
  return `${connection.host}:${connection.port}${tls}`;
}

/** Clé stable pour comparer deux cibles Redis (host + port). */
export function redisConnectionKey(connection: RedisConnectionConfig): string {
  return `${connection.host}:${connection.port}`;
}

export function redisConnectionEquals(
  a: RedisConnectionConfig,
  b: RedisConnectionConfig,
): boolean {
  return redisConnectionKey(a) === redisConnectionKey(b);
}

export function isRedisReadonlyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return msg.includes('READONLY');
}

/** Primary cache seul — clients écriture (SharedRedis, SSE publish, tokens). */
export function listRedisCacheWriteConnectionsFromGetter(
  get: RedisEnvGetter,
): RedisConnectionConfig[] {
  const primary = readRedisConnectionWithKeys(get, CACHE_REDIS_KEYS);
  return primary ? [primary] : [];
}

export function listRedisCacheWriteConnectionsFromConfig(
  config: ConfigService | { get: (key: string) => string | undefined },
): RedisConnectionConfig[] {
  return listRedisCacheWriteConnectionsFromGetter((key) => config.get(key));
}

/** Primary BullMQ seul — files d’attente (écritures Lua obligatoires). */
export function listBullmqRedisWriteConnectionsFromGetter(
  get: RedisEnvGetter,
): RedisConnectionConfig[] {
  const primary = readBullmqRedisConnectionFromGetter(get);
  return primary ? [primary] : [];
}

export function listBullmqRedisWriteConnectionsFromConfig(
  config: ConfigService | { get: (key: string) => string | undefined },
): RedisConnectionConfig[] {
  return listBullmqRedisWriteConnectionsFromGetter((key) => config.get(key));
}

async function probeRedisWriteAccess(client: Redis): Promise<boolean> {
  const key = `__wise_eat:write_probe:${Date.now()}`;
  try {
    await client.set(key, '1', 'EX', 5);
    await client.del(key);
    return true;
  } catch (err) {
    return !isRedisReadonlyError(err);
  }
}

export type ConnectIoredisFailoverOptions = Partial<IoredisOptions> & {
  /**
   * Primary uniquement + sonde SET/DEL — pas de bascule vers les réplicas READONLY.
   * Réessaie le primary jusqu’à `writePrimaryAttempts` fois.
   */
  writeOnly?: boolean;
  writePrimaryAttempts?: number;
};

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

/** Options `cache-manager-redis-yet` / node-redis (socket TLS HAProxy / Stunnel). */
export function readRedisCacheStoreOptionsFromConfig(
  config: ConfigService,
): {
  url?: string;
  socket: {
    host: string;
    port: number;
    tls?: true;
    servername?: string;
    rejectUnauthorized?: boolean;
    family?: number;
    connectTimeout?: number;
  };
  username?: string;
  password?: string;
} | null {
  const conn = readRedisConnectionFromConfig(config);
  if (!conn) return null;
  const rejectUnauthorized =
    conn.tls && conn.tls.rejectUnauthorized === false ? false : undefined;
  const ipFamily = readRedisIpFamily((key) => config.get(key));
  const connectTimeout = parsePositiveInt(
    config.get<string>('REDIS_CONNECT_TIMEOUT_MS'),
    15_000,
  );
  return {
    // Auth explicite (évite les divergences de parsing URL node-redis → WRONGPASS).
    username: conn.username,
    password: conn.password,
    socket: {
      host: conn.host,
      port: conn.port,
      ...(conn.tls
        ? {
            tls: true as const,
            servername:
              (conn.tls.servername as string | undefined) || conn.host,
            ...(rejectUnauthorized === false
              ? { rejectUnauthorized: false }
              : {}),
          }
        : {}),
      ...(ipFamily != null ? { family: ipFamily } : {}),
      connectTimeout,
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
  family?: number;
  keepAlive?: number;
  maxRetriesPerRequest: number | null;
  connectTimeout?: number;
  lazyConnect?: boolean;
  enableReadyCheck?: boolean;
  retryStrategy?: (times: number) => number | null;
  reconnectOnError?: (err: Error) => boolean | 1 | 2;
};

export function buildIoredisOptionsFromConnection(
  connection: RedisConnectionConfig,
  overrides?: Partial<IoredisOptions>,
): IoredisOptions {
  const ipFamily = readRedisIpFamily();
  const keepAliveMs = readRedisTcpKeepAliveMs();
  const tlsOpts = connection.tls
    ? { reconnectOnError: ioredisReconnectOnTlsError }
    : {};
  return {
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: connection.password,
    tls: connection.tls,
    ...(ipFamily != null ? { family: ipFamily } : {}),
    ...(keepAliveMs > 0 ? { keepAlive: keepAliveMs } : {}),
    ...tlsOpts,
    maxRetriesPerRequest: 2,
    connectTimeout: parsePositiveInt(
      process.env.REDIS_CONNECT_TIMEOUT_MS,
      15_000,
    ),
    retryStrategy: redisRetryStrategy,
    ...overrides,
  };
}

/** Reconnexion ioredis — limite les ETIMEDOUT en rafale (BullMQ + clients partagés). */
export function redisRetryStrategy(times: number): number | null {
  if (times > 30) return null;
  return Math.min(times * 500, 5_000);
}

/** Évite les rafales TLS Stunnel après alert decode / timeout (souvent bruit, pas fatal). */
export function ioredisReconnectOnTlsError(err: Error): boolean | 1 | 2 {
  const msg = err.message ?? '';
  if (
    msg.includes('decode error') ||
    msg.includes('DECODE_ERROR') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ECONNREFUSED')
  ) {
    return 2;
  }
  return true;
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

/** Tente chaque candidat jusqu’à une connexion réussie (primary puis réplicas en lecture). */
export async function connectIoredisWithFailover(
  candidates: RedisConnectionConfig[],
  overrides?: ConnectIoredisFailoverOptions,
): Promise<{ client: Redis; connection: RedisConnectionConfig } | null> {
  const {
    writeOnly = false,
    writePrimaryAttempts = 3,
    ...ioredisOverrides
  } = overrides ?? {};
  const list = writeOnly ? candidates.slice(0, 1) : candidates;
  if (!list.length) return null;

  const attempts = writeOnly ? Math.max(1, writePrimaryAttempts) : 1;

  for (const connection of list) {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const client = new Redis(
        buildIoredisOptionsFromConnection(connection, {
          enableReadyCheck: true,
          lazyConnect: true,
          ...ioredisOverrides,
        }),
      );
      try {
        await client.connect();
        if (writeOnly) {
          const writable = await probeRedisWriteAccess(client);
          if (!writable) {
            client.disconnect();
            continue;
          }
        }
        return { client, connection };
      } catch {
        client.disconnect();
      }
      if (writeOnly && attempt < attempts) {
        await new Promise((r) => setTimeout(r, Math.min(attempt * 500, 2_000)));
      }
    }
  }
  return null;
}
