import type { ConfigService } from '@nestjs/config';
import type { Connection } from 'mongoose';
import type { MqttRuntimeStatus } from '@modules/ws-notify/ws-notify-dispatch-queue.service';
import type {
  SystemExchangeLink,
  SystemExchangePlatform,
  SystemExchangeResponse,
  SystemExchangeStatus,
  WsGrpcRuntimeStatus,
} from './system-exchange.types';
import {
  isBullmqRedisDedicated,
  readRedisUrlFromConfig,
} from '../../common/redis/redis-connection.util';
import {
  grpcEnvFlag,
  mqttToExchange,
  probeBullmqRedis,
  probeCacheRedis,
  probeGrpcApiInternal,
  probeGrpcWsNotify,
  probeHttpHealth,
  probeMongoDb,
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
  runtime: {
    redisManagerEnabled: boolean;
    mqBrokerEnabled: boolean;
    grpcWsNotifyEnabled: boolean;
  };
  wsGrpc: WsGrpcRuntimeStatus;
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
  const grpcWsHost = input.config.get<string>('GRPC_WS_HOST')?.trim() || '127.0.0.1';
  const grpcWsPort = String(
    input.config.get<string>('GRPC_WS_PORT')?.trim() || '50051',
  );
  const grpcApiPort = String(
    input.config.get<string>('GRPC_API_PORT')?.trim() || '50052',
  );
  const grpcWsEndpoint = `${grpcWsHost}:${grpcWsPort}`;
  const grpcApiHost =
    input.config.get<string>('GRPC_API_BIND_HOST')?.trim() || '127.0.0.1';
  const grpcApiEndpoint = `${grpcApiHost}:${grpcApiPort}`;

  const [
    mongoProbe,
    redisCacheProbe,
    redisBullmqProbe,
    apiProbe,
    wsProbe,
    sseProbe,
    webProbe,
    grpcWsProbe,
    grpcApiProbe,
  ] = await Promise.all([
    probeMongoDb(input.connection),
    probeCacheRedis(input.config),
    probeBullmqRedis(input.config),
    probeHttpHealth(apiHealthUrl),
    probeHttpHealth(wsHealthUrl),
    probeSseStream(wsSsePublicUrl, 12000),
    probeHttpHealth(webPublic, 5000),
    probeGrpcWsNotify(input.config),
    probeGrpcApiInternal(input.config),
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
    : redisCacheProbe.status;

  const bullmqRedisStatus: SystemExchangeStatus = redisBullmqProbe.status;

  const mqttRuntimeStatus: SystemExchangeStatus = !input.runtime.mqBrokerEnabled
    ? 'disabled'
    : mqttBrokerStatus;

  const firebaseStatus: SystemExchangeStatus = input.firebaseMessagingOk
    ? 'healthy'
    : 'degraded';

  const platforms: SystemExchangePlatform[] = [
    platform('mongodb', 'MongoDB', 'data', 'Base de données principale', mongoProbe, null),
    platform(
      'redis-cache',
      'Redis cache / SSE',
      'data',
      'Cache HTTP multicache, pub/sub SSE, tokens partagés (REDIS_*)',
      input.runtime.redisManagerEnabled
        ? redisCacheProbe
        : { status: 'disabled', latencyMs: null, details: 'Redis Manager désactivé (runtime).' },
      readRedisUrlFromConfig(input.config),
    ),
    platform(
      'redis-bullmq',
      'Redis BullMQ',
      'data',
      isBullmqRedisDedicated(input.config)
        ? 'Files jobs asynchrones (BULLMQ_REDIS_*)'
        : 'Files jobs — instance partagée (repli REDIS_*)',
      { status: bullmqRedisStatus, latencyMs: redisBullmqProbe.latencyMs, details: redisBullmqProbe.details },
      input.config.get<string>('BULLMQ_REDIS_URL')?.trim() ||
        (isBullmqRedisDedicated(input.config)
          ? null
          : readRedisUrlFromConfig(input.config)),
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
      'grpc-ws',
      'gRPC WS (Notify)',
      'service',
      'NotifyService · Health · Fleet stream (:50051)',
      grpcWsProbe,
      grpcWsEndpoint,
    ),
    platform(
      'grpc-api',
      'gRPC API (interne)',
      'service',
      'InboxFeed · ChatPush — WS → API (:50052)',
      grpcApiProbe,
      grpcApiEndpoint,
    ),
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
  byId['grpc-ws'] = grpcWsProbe.status;
  byId['grpc-api'] = grpcApiProbe.status;

  const grpcNotifyActive = input.runtime.grpcWsNotifyEnabled;
  const wsGrpc = input.wsGrpc;
  const grpcWsToApiActive =
    wsGrpc.source === 'ws-internal'
      ? wsGrpc.wsToApiEnabled
      : grpcEnvFlag(input.config, 'GRPC_WS_TO_API_ENABLED', false);
  const wsToApiDetails = grpcWsToApiActive
    ? `InboxFeed · ChatPush ${wsGrpc.apiHost}:${wsGrpc.apiPort}${
        wsGrpc.clientsReady ? '' : ' · clients WS non prêts'
      }${wsGrpc.lastError ? ` — ${wsGrpc.lastError}` : ''} · ${grpcApiProbe.details}`
    : wsGrpc.source === 'unknown'
      ? 'Désactivé ou statut WS indisponible — repli HTTP interne WS.'
      : 'Désactivé (GRPC_WS_TO_API_ENABLED=false côté WS) — repli HTTP interne WS.';

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
      'api-redis-cache',
      'api',
      'redis-cache',
      'Redis protocol',
      'API → Redis cache',
      byId.api,
      redisRuntimeStatus,
      'Cache multicache, SSE publish, tokens',
      redisCacheProbe.latencyMs,
    ),
    communication(
      'api-redis-bullmq',
      'api',
      'redis-bullmq',
      'Redis protocol',
      'API → Redis BullMQ',
      byId.api,
      bullmqRedisStatus,
      'Files ws-notify, domain events, alertes',
      redisBullmqProbe.latencyMs,
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
      grpcNotifyActive ? 'API → WS (HTTP fallback)' : 'API → WS (notify)',
      byId.api,
      byId.ws,
      grpcNotifyActive
        ? 'Repli HTTP si gRPC indisponible (GRPC_HTTP_FALLBACK_ENABLED).'
        : 'Canal principal notify API → WS (HTTP interne).',
      wsProbe.latencyMs,
    ),
    communication(
      'api-ws-grpc',
      'api',
      'grpc-ws',
      'gRPC (NotifyService)',
      'API → WS (gRPC)',
      byId.api,
      grpcNotifyActive ? byId['grpc-ws'] : 'disabled',
      grpcNotifyActive
        ? `NotifyService :50051 · ${grpcWsProbe.details}`
        : 'Désactivé (runtime grpcWsNotifyEnabled=false) — HTTP/MQTT actifs.',
      grpcWsProbe.latencyMs,
    ),
    communication(
      'ws-api-grpc',
      'ws',
      'grpc-api',
      'gRPC (InboxFeed / ChatPush)',
      'WS → API (gRPC)',
      byId.ws,
      grpcWsToApiActive ? byId['grpc-api'] : 'disabled',
      wsToApiDetails,
      grpcApiProbe.latencyMs,
    ),
    communication(
      'api-sse-redis',
      'api',
      'redis-cache',
      'Redis pub/sub',
      'API → Redis → SSE',
      byId.api,
      redisRuntimeStatus,
      'Publication canaux sse:ch:*',
      redisCacheProbe.latencyMs,
    ),
    communication(
      'sse-redis-ws',
      'redis-cache',
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
