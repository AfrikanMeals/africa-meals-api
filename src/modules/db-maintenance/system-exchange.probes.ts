import { readBullmqRedisConnectionFromConfig } from '../../common/bullmq-redis-connection';
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

export async function probeRedis(config: ConfigService): Promise<ProbeResult> {
  const conn = readBullmqRedisConnectionFromConfig(config);
  if (!conn) {
    return {
      status: 'disabled',
      latencyMs: null,
      details: 'REDIS_URL ou REDIS_HOST non configuré.',
    };
  }
  const started = performance.now();
  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis({
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password: conn.password,
      tls: conn.tls,
      connectTimeout: 4000,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    await client.connect();
    const pong = await client.ping();
    await client.quit();
    const latencyMs = Math.round(performance.now() - started);
    return {
      status: pong === 'PONG' ? 'healthy' : 'degraded',
      latencyMs,
      details: `PING → ${pong} (${conn.host}:${conn.port})`,
    };
  } catch (e) {
    return {
      status: 'down',
      latencyMs: Math.round(performance.now() - started),
      details: e instanceof Error ? e.message : String(e),
    };
  }
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
