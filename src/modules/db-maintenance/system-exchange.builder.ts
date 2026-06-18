import type { ConfigService } from '@nestjs/config';
import type { Connection } from 'mongoose';
import type { MqttRuntimeStatus } from '@modules/ws-notify/ws-notify-dispatch-queue.service';
import type {
  SystemExchangeLink,
  SystemExchangePlatform,
  SystemExchangeResponse,
  SystemExchangeStatus,
} from './system-exchange.types';
import {
  mqttToExchange,
  probeHttpHealth,
  probeMongoDb,
  probeRedis,
  probeSseStream,
  resolveApiHealthProbeUrl,
  type ProbeResult,
} from './system-exchange.probes';

type BuildSystemExchangeInput = {
  config: ConfigService;
  connection: Connection;
  mqtt: {
    apiPublisher: MqttRuntimeStatus;
    wsSubscriber: MqttRuntimeStatus;
  };
  runtime: { redisManagerEnabled: boolean; mqBrokerEnabled: boolean };
  firebaseMessagingOk: boolean;
};

function summarize(platforms: SystemExchangePlatform[]) {
  const summary = {
    healthy: 0,
    degraded: 0,
    down: 0,
    disabled: 0,
    unknown: 0,
  };
  for (const p of platforms) {
    summary[p.status] += 1;
  }
  return summary;
}

function linkStatus(
  from: SystemExchangeStatus,
  to: SystemExchangeStatus,
): SystemExchangeStatus {
  if (from === 'disabled' || to === 'disabled') return 'disabled';
  if (from === 'down' || to === 'down') return 'down';
  if (from === 'degraded' || to === 'degraded') return 'degraded';
  if (from === 'unknown' || to === 'unknown') return 'unknown';
  return 'healthy';
}

function platform(
  id: string,
  label: string,
  layer: SystemExchangePlatform['layer'],
  role: string,
  probe: ProbeResult,
  endpoint: string | null,
): SystemExchangePlatform {
  return {
    id,
    label,
    layer,
    role,
    status: probe.status,
    latencyMs: probe.latencyMs,
    details: probe.details,
    endpoint,
  };
}

function communication(
  id: string,
  from: string,
  to: string,
  protocol: string,
  label: string,
  fromStatus: SystemExchangeStatus,
  toStatus: SystemExchangeStatus,
  details: string,
  latencyMs: number | null = null,
): SystemExchangeLink {
  return {
    id,
    from,
    to,
    protocol,
    label,
    status: linkStatus(fromStatus, toStatus),
    latencyMs,
    details,
  };
}

export async function buildSystemExchangeResponse(
  input: BuildSystemExchangeInput,
): Promise<SystemExchangeResponse> {
  const env = String(
    input.config.get('NODE_ENV') ?? process.env.NODE_ENV ?? 'development',
  ).trim();

  const apiPublic =
    input.config.get<string>('SERVER_URL')?.trim() ||
    `http://localhost:${input.config.get('NODE_PORT') ?? '9000'}`;
  const wsInternal =
    input.config.get<string>('AFRICA_MEALS_WS_INTERNAL_URL')?.trim() ||
    'http://localhost:8000';
  const wsPublic =
    input.config.get<string>('AFRICA_MEALS_WS_PUBLIC_URL')?.trim() ||
    wsInternal;
  const webPublic =
    input.config.get<string>('AFRICA_MEALS_WEB_PUBLIC_URL')?.trim() ||
    'https://wise-eat.com';
  const adminPublic =
    input.config.get<string>('AFRICA_MEALS_ADMIN_PUBLIC_URL')?.trim() ||
    'http://localhost:3001';

  const wsHealthUrl = `${wsInternal.replace(/\/$/, '')}/api/health`;
  const wsSsePublicUrl = `${wsInternal.replace(/\/$/, '')}/api/sse/public/status`;
  const apiHealthUrl = resolveApiHealthProbeUrl(apiPublic);

  const [
    mongoProbe,
    redisProbe,
    apiProbe,
    wsProbe,
    sseProbe,
    webProbe,
  ] = await Promise.all([
    probeMongoDb(input.connection),
    probeRedis(input.config),
    probeHttpHealth(apiHealthUrl),
    probeHttpHealth(wsHealthUrl),
    probeSseStream(wsSsePublicUrl, 12000),
    probeHttpHealth(webPublic, 5000),
  ]);

  const sseResolved: ProbeResult =
    sseProbe.status !== 'down' || wsProbe.status !== 'healthy'
      ? sseProbe
      : {
          status: 'healthy',
          latencyMs: wsProbe.latencyMs,
          details:
            'Instance WS OK — flux SSE lent au démarrage (première sonde interne).',
        };

  const apiMqtt = input.mqtt.apiPublisher;
  const wsMqtt = input.mqtt.wsSubscriber;
  const mqttBrokerStatus = mqttToExchange(apiMqtt.state);
  const wsMqttStatus = mqttToExchange(wsMqtt.state);

  const redisRuntimeStatus: SystemExchangeStatus = !input.runtime.redisManagerEnabled
    ? 'disabled'
    : redisProbe.status;

  const mqttRuntimeStatus: SystemExchangeStatus = !input.runtime.mqBrokerEnabled
    ? 'disabled'
    : mqttBrokerStatus;

  const firebaseStatus: SystemExchangeStatus = input.firebaseMessagingOk
    ? 'healthy'
    : 'degraded';

  const platforms: SystemExchangePlatform[] = [
    platform('mongodb', 'MongoDB', 'data', 'Base de données principale', mongoProbe, null),
    platform(
      'redis',
      'Redis',
      'data',
      'Files BullMQ, cache SSE, domain events',
      input.runtime.redisManagerEnabled
        ? redisProbe
        : { status: 'disabled', latencyMs: null, details: 'Redis Manager désactivé (runtime).' },
      input.config.get<string>('REDIS_URL')?.trim() || null,
    ),
    platform(
      'mqtt-broker',
      'MQTT Broker',
      'infra',
      'Bus événements API → WS (domain events, notify)',
      {
        status: mqttRuntimeStatus,
        latencyMs: null,
        details:
          mqttRuntimeStatus === 'disabled'
            ? 'MQ Broker désactivé (runtime).'
            : `Publisher API: ${apiMqtt.state}${apiMqtt.lastTopicSeen ? ` · dernier topic ${apiMqtt.lastTopicSeen}` : ''}`,
      },
      input.config.get<string>('MQTT_BROKER_URL')?.trim() || null,
    ),
    platform('api', 'API REST', 'service', 'NestJS — logique métier, webhooks, SSE publish', apiProbe, apiPublic),
    platform('ws', 'WebSocket (WS)', 'service', 'Socket.IO chat, commandes temps réel, SSE HTTP', wsProbe, wsPublic),
    platform(
      'sse',
      'SSE (WS)',
      'service',
      'Flux admin (health, fleet, jobs) via Redis pub/sub',
      sseResolved,
      wsSsePublicUrl,
    ),
    platform(
      'firebase',
      'Firebase (FCM)',
      'infra',
      'Push mobile & web',
      {
        status: firebaseStatus,
        latencyMs: null,
        details: input.firebaseMessagingOk
          ? 'Firebase Messaging initialisé.'
          : 'Firebase Messaging indisponible.',
      },
      null,
    ),
    platform(
      'admin',
      'Admin Dashboard',
      'client',
      'Next.js — REST API + SSE + Socket.IO',
      {
        status: 'unknown',
        latencyMs: null,
        details: `Client navigateur — URL attendue ${adminPublic}`,
      },
      adminPublic,
    ),
    platform(
      'mobile',
      'Mobile App',
      'client',
      'Flutter — REST API + Socket.IO + FCM',
      {
        status: firebaseStatus === 'healthy' && apiProbe.status === 'healthy'
          ? 'healthy'
          : apiProbe.status === 'healthy'
            ? 'degraded'
            : 'down',
        latencyMs: null,
        details: 'Inféré via API + Firebase (pas de sonde directe sur l’app).',
      },
      null,
    ),
    platform(
      'web',
      'Web (vitrine)',
      'client',
      'Site public — checkout, statut services',
      webProbe,
      webPublic,
    ),
  ];

  const byId = Object.fromEntries(
    platforms.map((p) => [p.id, p.status]),
  ) as Record<string, SystemExchangeStatus>;
  byId.sse = sseResolved.status;

  const links: SystemExchangeLink[] = [
    communication(
      'admin-api',
      'admin',
      'api',
      'HTTPS / REST',
      'Admin → API',
      'unknown',
      byId.api,
      'JWT Bearer — auth, commandes, settings',
      apiProbe.latencyMs,
    ),
    communication(
      'admin-sse',
      'admin',
      'sse',
      'SSE (EventSource)',
      'Admin → SSE',
      'unknown',
      byId.sse,
      'JWT query token — health, fleet, jobs',
      sseResolved.latencyMs,
    ),
    communication(
      'admin-ws',
      'admin',
      'ws',
      'WebSocket (Socket.IO)',
      'Admin → WS chat',
      'unknown',
      byId.ws,
      'Namespace /chat — suivi commandes, inbox',
      wsProbe.latencyMs,
    ),
    communication(
      'mobile-api',
      'mobile',
      'api',
      'HTTPS / REST',
      'Mobile → API',
      byId.mobile,
      byId.api,
      'Auth JWT + refresh',
      apiProbe.latencyMs,
    ),
    communication(
      'mobile-ws',
      'mobile',
      'ws',
      'WebSocket (Socket.IO)',
      'Mobile → WS',
      byId.mobile,
      byId.ws,
      'Tracking commandes, chat livraison',
      wsProbe.latencyMs,
    ),
    communication(
      'mobile-fcm',
      'api',
      'firebase',
      'FCM HTTP',
      'API → Firebase push',
      byId.api,
      byId.firebase,
      'Notifications push commandes / ads',
    ),
    communication(
      'web-api',
      'web',
      'api',
      'HTTPS / REST',
      'Web → API',
      byId.web,
      byId.api,
      'Checkout, statut public',
      apiProbe.latencyMs,
    ),
    communication(
      'api-db',
      'api',
      'mongodb',
      'MongoDB wire',
      'API → MongoDB',
      byId.api,
      byId.mongodb,
      'Mongoose ODM',
      mongoProbe.latencyMs,
    ),
    communication(
      'api-redis',
      'api',
      'redis',
      'Redis protocol',
      'API → Redis',
      byId.api,
      redisRuntimeStatus,
      'BullMQ, SSE publish, idempotency',
      redisProbe.latencyMs,
    ),
    communication(
      'api-mqtt',
      'api',
      'mqtt-broker',
      'MQTT publish',
      'API → MQTT',
      byId.api,
      mqttRuntimeStatus,
      `Publisher ${apiMqtt.state}${apiMqtt.lastError ? ` — ${apiMqtt.lastError}` : ''}`,
    ),
    communication(
      'ws-mqtt',
      'ws',
      'mqtt-broker',
      'MQTT subscribe',
      'WS ← MQTT',
      byId.ws,
      wsMqttStatus,
      `Subscriber ${wsMqtt.state}${wsMqtt.lastError ? ` — ${wsMqtt.lastError}` : ''}`,
    ),
    communication(
      'api-ws-internal',
      'api',
      'ws',
      'HTTP interne',
      'API → WS (fallback)',
      byId.api,
      byId.ws,
      'Notify direct si MQTT/Redis indisponible',
      wsProbe.latencyMs,
    ),
    communication(
      'api-sse-redis',
      'api',
      'redis',
      'Redis pub/sub',
      'API → Redis → SSE',
      byId.api,
      redisRuntimeStatus,
      'Publication canaux sse:ch:*',
      redisProbe.latencyMs,
    ),
    communication(
      'sse-redis-ws',
      'redis',
      'sse',
      'Redis pub/sub',
      'Redis → WS SSE',
      redisRuntimeStatus,
      byId.sse,
      'Abonnement WS aux canaux SSE',
      sseResolved.latencyMs,
    ),
    communication(
      'ws-clients',
      'ws',
      'admin',
      'Socket.IO emit',
      'WS → clients',
      byId.ws,
      'unknown',
      'Broadcast order:update, chat, fleet',
    ),
  ];

  return {
    checkedAt: new Date().toISOString(),
    environment: env,
    platforms,
    links,
    summary: summarize(platforms),
  };
}
