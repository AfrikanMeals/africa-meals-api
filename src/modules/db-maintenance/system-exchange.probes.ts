import {
  formatRedisTarget,
  isBullmqRedisDedicated,
  readBullmqRedisConnectionFromConfig,
  readRedisConnectionFromConfig,
  buildIoredisOptionsFromConnection,
} from '../../common/redis/redis-connection.util';
import type { ConfigService } from '@nestjs/config';
import type { Connection } from 'mongoose';
import type { MqttRuntimeStatus } from '@modules/ws-notify/ws-notify-dispatch-queue.service';
import type { SystemExchangeStatus } from './system-exchange.types';

export type ProbeResult = {
  status: SystemExchangeStatus;
  latencyMs: number | null;
  details: string;
};

export function healthToExchange(
  status: 'healthy' | 'degraded' | 'down' | undefined,
): SystemExchangeStatus {
  if (status === 'healthy') return 'healthy';
  if (status === 'degraded') return 'degraded';
  if (status === 'down') return 'down';
  return 'unknown';
}

export function mqttToExchange(state?: MqttRuntimeStatus['state']): SystemExchangeStatus {
  switch (state) {
    case 'connected':
      return 'healthy';
    case 'connecting':
    case 'reconnecting':
      return 'degraded';
    case 'disabled':
      return 'disabled';
    case 'error':
      return 'down';
    default:
      return 'unknown';
  }
}

/** Nest local : `/api/health` — hôtes API dédiés (Cloud Run / api.*) : `/health`. */
/**
 * MinIO en path-style envoie `HEAD /{bucket}/` (ex. `/wise-eat/`).
 * Si MINIO_ENDPOINT pointe sur le même port que l’API Nest (PM2 prod local :9000),
 * la sonde frappe l’API et pollue les logs — pas un proxy vitrine.
 */
export function resolveMinioHealthProbeSkipReason(
  config: ConfigService,
): string | null {
  if (config.get<string>('MINIO_HEALTH_CHECK')?.trim() === 'false') {
    return 'sonde désactivée (MINIO_HEALTH_CHECK=false)';
  }
  if (config.get<string>('MINIO_ENABLED')?.trim() === 'false') {
    return 'MinIO désactivé (MINIO_ENABLED=false)';
  }

  const endpoint = config.get<string>('MINIO_ENDPOINT')?.trim() ?? '';
  if (!endpoint) return null;

  const apiPort = String(
    config.get<string>('PORT') ?? config.get<string>('NODE_PORT') ?? '',
  ).trim();
  if (!apiPort) return null;

  try {
    const url = new URL(
      endpoint.startsWith('http') ? endpoint : `http://${endpoint}`,
    );
    const host = url.hostname.toLowerCase();
    if (host !== 'localhost' && host !== '127.0.0.1') return null;
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    if (port === apiPort) {
      return `MINIO_ENDPOINT (${endpoint}) partage le port ${port} avec l’API — sonde ignorée`;
    }
  } catch {
    return null;
  }
  return null;
}

export function resolveApiHealthProbeUrl(serverUrl: string): string {
  const raw = serverUrl.trim().replace(/\/+$/, '').replace(/\/api\/health$/, '');
  if (!raw) return 'http://localhost:9000/api/health';
  try {
    const url = new URL(raw.startsWith('http') ? raw : `http://${raw}`);
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') {
      return `${url.origin}/api/health`;
    }
    if (
      /^api(-[a-z0-9-]+)?\.wise-eat\.com$/i.test(host) ||
      host.endsWith('.cloudfunctions.net') ||
      host.endsWith('.run.app')
    ) {
      return `${url.origin}/health`;
    }
    return `${url.origin}/api/health`;
  } catch {
    return `${raw}/api/health`;
  }
}

/** SSE = flux long ; on vérifie seulement les en-têtes HTTP (pas le corps). */
export async function probeSseStream(
  url: string,
  timeoutMs = 8000,
): Promise<ProbeResult> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });
    const latencyMs = Math.round(performance.now() - started);
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    void res.body?.cancel().catch(() => undefined);
    if (!res.ok) {
      return {
        status: 'down',
        latencyMs,
        details: `HTTP ${res.status}`,
      };
    }
    if (!contentType.includes('text/event-stream')) {
      return {
        status: 'degraded',
        latencyMs,
        details: `Content-Type inattendu: ${contentType || '—'}`,
      };
    }
    return {
      status: 'healthy',
      latencyMs,
      details: 'Flux SSE — en-têtes OK.',
    };
  } catch (e) {
    return {
      status: 'down',
      latencyMs: Math.round(performance.now() - started),
      details: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function probeMongoDb(connection: Connection): Promise<ProbeResult> {
  const started = performance.now();
  const db = connection.db;
  if (!db) {
    return {
      status: 'down',
      latencyMs: null,
      details: 'Connexion MongoDB non initialisée.',
    };
  }
  try {
    const pingRes = (await db.admin().ping()) as { ok?: number };
    const latencyMs = Math.round(performance.now() - started);
    const ok = Number(pingRes?.ok ?? 0) === 1;
    return {
      status: ok ? 'healthy' : 'degraded',
      latencyMs,
      details: ok ? 'Ping OK.' : `Réponse inattendue: ${JSON.stringify(pingRes)}`,
    };
  } catch (e) {
    return {
      status: 'down',
      latencyMs: Math.round(performance.now() - started),
      details: e instanceof Error ? e.message : String(e),
    };
  }
}

async function probeRedisConnection(
  config: ConfigService,
  conn: ReturnType<typeof readRedisConnectionFromConfig>,
  label: string,
  missingDetails: string,
): Promise<ProbeResult> {
  if (!conn) {
    return {
      status: 'disabled',
      latencyMs: null,
      details: missingDetails,
    };
  }
  const started = performance.now();
  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(
      buildIoredisOptionsFromConnection(conn, {
        connectTimeout: 4000,
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      }),
    );
    await client.connect();
    const pong = await client.ping();
    await client.quit();
    const latencyMs = Math.round(performance.now() - started);
    return {
      status: pong === 'PONG' ? 'healthy' : 'degraded',
      latencyMs,
      details: `${label} PING → ${pong} (${formatRedisTarget(conn)})`,
    };
  } catch (e) {
    return {
      status: 'down',
      latencyMs: Math.round(performance.now() - started),
      details: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Cache HTTP, pub/sub SSE, tokens — `REDIS_*`. */
export async function probeCacheRedis(config: ConfigService): Promise<ProbeResult> {
  return probeRedisConnection(
    config,
    readRedisConnectionFromConfig(config),
    'Cache',
    'REDIS_URL ou REDIS_HOST non configuré.',
  );
}

/** Files BullMQ — `BULLMQ_REDIS_*` (repli `REDIS_*`). */
export async function probeBullmqRedis(config: ConfigService): Promise<ProbeResult> {
  const dedicated = isBullmqRedisDedicated(config);
  const conn = readBullmqRedisConnectionFromConfig(config);
  const probe = await probeRedisConnection(
    config,
    conn,
    dedicated ? 'BullMQ (dedicated)' : 'BullMQ (shared fallback)',
    'BULLMQ_REDIS_* / REDIS_* non configuré.',
  );
  if (probe.status === 'healthy' && !dedicated) {
    return {
      ...probe,
      details: `${probe.details} — instance partagée (REDIS_*). Définir BULLMQ_REDIS_* pour séparer.`,
    };
  }
  return probe;
}

/** @deprecated Préférer probeCacheRedis ou probeBullmqRedis. */
export async function probeRedis(config: ConfigService): Promise<ProbeResult> {
  return probeCacheRedis(config);
}

export async function probeHttpHealth(
  url: string,
  timeoutMs = 5000,
  init?: RequestInit,
): Promise<ProbeResult> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      ...(init ?? {}),
    });
    const latencyMs = Math.round(performance.now() - started);
    const body = (await res.text()).slice(0, 120);
    if (!res.ok) {
      return {
        status: 'down',
        latencyMs,
        details: `HTTP ${res.status}${body ? ` — ${body}` : ''}`,
      };
    }
    return {
      status: 'healthy',
      latencyMs,
      details: body || `HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      status: 'down',
      latencyMs: Math.round(performance.now() - started),
      details: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timer);
  }
}

function resolveMemcachedServers(config: ConfigService): string | null {
  const direct =
    config.get<string>('MEMCACHED_SERVERS')?.trim() ||
    config.get<string>('MEMCACHED_URL')?.trim();
  if (direct) return direct;
  const host = config.get<string>('MEMCACHED_HOST')?.trim();
  if (!host) return null;
  const port = config.get<string>('MEMCACHED_PORT')?.trim() || '11211';
  return `${host}:${port}`;
}

/** Ping Memcached (set/get) pour multicache engine + System Health. */
export async function probeMemcached(
  config: ConfigService,
): Promise<ProbeResult> {
  const servers = resolveMemcachedServers(config);
  if (!servers) {
    return {
      status: 'disabled',
      latencyMs: null,
      details: 'MEMCACHED_SERVERS / MEMCACHED_HOST non configuré.',
    };
  }
  const started = performance.now();
  const Memcached = (await import('memcached')).default;
  const client = new Memcached(servers, {
    timeout: 2000,
    retries: 1,
    retry: 300,
  });
  const key = `__wise_eat_health_${Date.now()}`;
  return new Promise((resolve) => {
    client.set(key, '1', 10, (setErr) => {
      if (setErr) {
        client.end();
        resolve({
          status: 'down',
          latencyMs: Math.round(performance.now() - started),
          details: `SET échoué: ${setErr.message}`,
        });
        return;
      }
      client.get(key, (getErr, data) => {
        client.end();
        const latencyMs = Math.round(performance.now() - started);
        if (getErr) {
          resolve({
            status: 'down',
            latencyMs,
            details: `GET échoué: ${getErr.message}`,
          });
          return;
        }
        if (String(data) !== '1') {
          resolve({
            status: 'degraded',
            latencyMs,
            details: `Round-trip inattendu (${servers}).`,
          });
          return;
        }
        resolve({
          status: 'healthy',
          latencyMs,
          details: `SET/GET OK (${servers}).`,
        });
      });
    });
  });
}
