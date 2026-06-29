import {
  formatRedisTarget,
  isBullmqRedisDedicated,
  readBullmqRedisConnectionFromConfig,
  readRedisConnectionFromConfig,
  buildIoredisOptionsFromConnection,
} from '../../common/redis/redis-connection.util';
import {
  buildMinioS3ClientConfig,
  parseMinioEndpoints,
} from '../medias/minio-endpoints.util';
import type { ConfigService } from '@nestjs/config';
import type { Connection } from 'mongoose';
import type { MqttRuntimeStatus } from '@modules/ws-notify/ws-notify-dispatch-queue.service';
import type { SystemExchangeStatus } from './system-exchange.types';
import {
  readMemcachedConnectionFromConfig,
} from '../../common/cache/memcached-connection.util';
import { tlsMemcachedPing } from '../../common/cache/memcached-tls-client';
import {
  resolveGrpcApiProbeHost,
  resolveGrpcWsProbeHost,
} from '../sse-stream/status-probe-urls.util';
import {
  getProtoServiceClientConstructor,
  grpc,
  grpcInternalMetadata,
  loadInboxV1,
  loadNotifyV1,
  parsePositiveInt,
  grpcVersionSupportsCoreInternal,
  parseGrpcVersion,
} from '@africa-meals/proto';

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

export type MinioStorageHealthProbe = {
  configured: boolean;
  ok: boolean;
  detail: string;
};

/** Sonde HeadBucket sur primaire puis réplicas (failover lecture côté API). */
export async function probeMinioStorageHealth(
  config: ConfigService,
): Promise<MinioStorageHealthProbe> {
  const skip = resolveMinioHealthProbeSkipReason(config);
  if (skip) {
    return { configured: false, ok: false, detail: skip };
  }

  const bucket = String(config.get<string>('MINIO_BUCKET') ?? '').trim();
  const key = String(config.get<string>('MINIO_ACCESS_KEY') ?? '').trim();
  const secret = String(config.get<string>('MINIO_SECRET_KEY') ?? '').trim();
  const endpoints = parseMinioEndpoints(config);
  if (!bucket || !key || !secret || !endpoints.length) {
    return { configured: false, ok: false, detail: 'non configuré' };
  }

  const { HeadBucketCommand, S3Client } = await import('@aws-sdk/client-s3');
  const parts: string[] = [];
  let primaryOk = false;
  let replicaOk = 0;
  const replicaTotal = Math.max(0, endpoints.length - 1);

  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i];
    const label = i === 0 ? 'primaire' : `réplica${i}`;
    try {
      const client = new S3Client(buildMinioS3ClientConfig(config, endpoint));
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      parts.push(`${label} OK`);
      if (i === 0) primaryOk = true;
      else replicaOk++;
    } catch (e) {
      parts.push(
        `${label} KO (${endpoint}): ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  const detail = parts.join(' · ');
  if (primaryOk) {
    return {
      configured: true,
      ok: replicaOk === replicaTotal,
      detail:
        replicaOk === replicaTotal
          ? detail
          : `${detail} — écritures OK, réplication partielle`,
    };
  }
  if (replicaOk > 0) {
    return {
      configured: true,
      ok: true,
      detail: `${detail} — primaire KO, lectures via réplicas`,
    };
  }
  return { configured: true, ok: false, detail };
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
    // Façade Worker (clients mobile/admin/web) — /health → origin /api/health
    if (host === 'apis.wise-eat.com') {
      return `${url.origin}/health`;
    }
    // Origin VPS k8s (nginx → Nest global prefix /api)
    if (/^api(-[a-z0-9-]+)?\.wise-eat\.com$/i.test(host)) {
      return `${url.origin}/api/health`;
    }
    if (host.endsWith('.cloudfunctions.net') || host.endsWith('.run.app')) {
      return `${url.origin}/health`;
    }
    return `${url.origin}/api/health`;
  } catch {
    return `${raw}/api/health`;
  }
}

export function resolveApiHealthProbeUrlFromConfig(
  config: ConfigService | { get: (key: string) => string | undefined },
): string {
  const direct = config.get<string>('STATUS_PROBE_API_URL')?.trim();
  if (direct) return direct.replace(/\/+$/, '');
  const publicBase =
    config.get<string>('API_PUBLIC_BASE_URL')?.trim() ||
    config.get<string>('SERVER_URL')?.trim();
  if (publicBase) return resolveApiHealthProbeUrl(publicBase);
  return resolveApiHealthProbeUrl(
    `http://localhost:${config.get('NODE_PORT') ?? '9000'}`,
  );
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
    client.on('error', () => undefined);
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

/** Ping Memcached (set/get) pour multicache engine + System Health. */
export async function probeMemcached(
  config: ConfigService,
): Promise<ProbeResult> {
  const connection = readMemcachedConnectionFromConfig(config);
  if (!connection) {
    return {
      status: 'disabled',
      latencyMs: null,
      details: 'MEMCACHED_SERVERS / MEMCACHED_HOST non configuré.',
    };
  }
  const servers = connection.servers;
  const started = performance.now();

  if (connection.tls) {
    try {
      await tlsMemcachedPing(connection.tls);
      return {
        status: 'healthy',
        latencyMs: Math.round(performance.now() - started),
        details: `SET/GET OK TLS (${servers}).`,
      };
    } catch (e) {
      return {
        status: 'down',
        latencyMs: Math.round(performance.now() - started),
        details: e instanceof Error ? e.message : String(e),
      };
    }
  }

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

export function grpcEnvFlag(config: ConfigService, key: string, defaultOn = true): boolean {
  const raw = (config.get<string>(key) ?? (defaultOn ? 'true' : 'false'))
    .trim()
    .toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no' && raw !== 'off';
}

function resolveGrpcInternalSecret(config: ConfigService): string {
  return (
    config.get<string>('INTERNAL_NOTIFY_SECRET')?.trim() ||
    config.get<string>('INTERNAL_WS_NOTIFY_SECRET')?.trim() ||
    config.get<string>('GRPC_INTERNAL_SECRET')?.trim() ||
    ''
  );
}

function probeDisabledIfGrpcVersionTooLow(
  config: ConfigService,
): ProbeResult | null {
  const version = parseGrpcVersion(config.get<string>('GRPC_VERSION'));
  if (!grpcVersionSupportsCoreInternal(version)) {
    return {
      status: 'disabled',
      latencyMs: null,
      details: `GRPC_VERSION=${version} — Phases 0–2 internes bloquées (minimum 1).`,
    };
  }
  return null;
}

function grpcVersionProbeSuffix(config: ConfigService): string {
  return ` · GRPC_VERSION=${parseGrpcVersion(config.get<string>('GRPC_VERSION'))}`;
}

/** Ping `NotifyService` sur africa-meals-ws (:50051). */
export async function probeGrpcWsNotify(
  config: ConfigService,
): Promise<ProbeResult> {
  const versionBlock = probeDisabledIfGrpcVersionTooLow(config);
  if (versionBlock) return versionBlock;
  if (!grpcEnvFlag(config, 'GRPC_WS_SERVER_ENABLED', true)) {
    return {
      status: 'disabled',
      latencyMs: null,
      details: 'Serveur gRPC WS désactivé (GRPC_WS_SERVER_ENABLED=false).',
    };
  }
  const secret = resolveGrpcInternalSecret(config);
  if (!secret) {
    return {
      status: 'disabled',
      latencyMs: null,
      details: 'INTERNAL_NOTIFY_SECRET absent — gRPC WS non testable.',
    };
  }
  const host = resolveGrpcWsProbeHost(config);
  const port = parsePositiveInt(config.get<string>('GRPC_WS_PORT'), 50051);
  const deadlineMs = parsePositiveInt(config.get<string>('GRPC_DEADLINE_MS'), 5000);
  const started = performance.now();

  const pkg = loadNotifyV1();
  const ctor = getProtoServiceClientConstructor(
    pkg,
    'wiseeat',
    'notify',
    'v1',
    'NotifyService',
  );
  if (!ctor) {
    return {
      status: 'down',
      latencyMs: null,
      details: 'Proto NotifyService introuvable.',
    };
  }

  const client = new ctor(
    `${host}:${port}`,
    grpc.credentials.createInsecure(),
  ) as unknown as {
    Ping: (
      req: Record<string, never>,
      md: grpc.Metadata,
      opts: grpc.CallOptions,
      cb: (err: grpc.ServiceError | null, res?: { service?: string }) => void,
    ) => void;
  };

  return new Promise((resolve) => {
    const md = grpcInternalMetadata(secret);
    const deadline = new Date(Date.now() + deadlineMs);
    client.Ping({}, md, { deadline }, (err, res) => {
      const latencyMs = Math.round(performance.now() - started);
      if (err || !res?.service) {
        resolve({
          status: 'down',
          latencyMs,
          details: err?.message ?? 'Ping gRPC WS sans réponse.',
        });
        return;
      }
      resolve({
        status: 'healthy',
        latencyMs,
        details: `${res.service} @ ${host}:${port}${grpcVersionProbeSuffix(config)}`,
      });
    });
  });
}

/** Sonde liveness serveur gRPC API (:50052) via InboxFeedService. */
export async function probeGrpcApiInternal(
  config: ConfigService,
): Promise<ProbeResult> {
  const versionBlock = probeDisabledIfGrpcVersionTooLow(config);
  if (versionBlock) return versionBlock;
  if (!grpcEnvFlag(config, 'GRPC_API_SERVER_ENABLED', true)) {
    return {
      status: 'disabled',
      latencyMs: null,
      details: 'Serveur gRPC API désactivé (GRPC_API_SERVER_ENABLED=false).',
    };
  }
  const secret = resolveGrpcInternalSecret(config);
  if (!secret) {
    return {
      status: 'disabled',
      latencyMs: null,
      details: 'INTERNAL_NOTIFY_SECRET absent — gRPC API non testable.',
    };
  }
  const host = resolveGrpcApiProbeHost(config);
  const port = parsePositiveInt(config.get<string>('GRPC_API_PORT'), 50052);
  const deadlineMs = parsePositiveInt(config.get<string>('GRPC_DEADLINE_MS'), 5000);
  const started = performance.now();

  const pkg = loadInboxV1();
  const ctor = getProtoServiceClientConstructor(
    pkg,
    'wiseeat',
    'inbox',
    'v1',
    'InboxFeedService',
  );
  if (!ctor) {
    return {
      status: 'down',
      latencyMs: null,
      details: 'Proto InboxFeedService introuvable.',
    };
  }

  const client = new ctor(
    `${host}:${port}`,
    grpc.credentials.createInsecure(),
  ) as unknown as {
    GetVendorFeed: (
      req: { userId: string },
      md: grpc.Metadata,
      opts: grpc.CallOptions,
      cb: (err: grpc.ServiceError | null, res?: { feedJson?: string }) => void,
    ) => void;
  };

  return new Promise((resolve) => {
    const md = grpcInternalMetadata(secret);
    const deadline = new Date(Date.now() + deadlineMs);
    client.GetVendorFeed({ userId: '__health__' }, md, { deadline }, (err) => {
      const latencyMs = Math.round(performance.now() - started);
      if (err) {
        resolve({
          status: 'down',
          latencyMs,
          details: err.message,
        });
        return;
      }
      resolve({
        status: 'healthy',
        latencyMs,
        details: `InboxFeedService @ ${host}:${port}${grpcVersionProbeSuffix(config)}`,
      });
    });
  });
}
