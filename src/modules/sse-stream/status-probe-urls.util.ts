import type { ConfigService } from '@nestjs/config';

const DEV_WS_PUBLIC = 'https://ws-dev.wise-eat.com';
const DEV_ADMIN_HEALTH = 'https://dashboard.wise-eat.com/api/health';
const DEV_WEB_URL = 'https://web.wise-eat.com/';

const PROD_HOSTS = new Set([
  'wise-eat.com',
  'www.wise-eat.com',
  'api.wise-eat.com',
  'ws.wise-eat.com',
  'admin.wise-eat.com',
]);

export function isDevStatusProbeStack(config: ConfigService): boolean {
  if (config.get<string>('STATUS_PROBE_USE_DEV_STACK') === 'true') return true;
  if (config.get<string>('NODE_ENV') === 'development') return true;

  const server = config.get<string>('SERVER_URL')?.trim().toLowerCase() ?? '';
  if (server.includes('localhost') || server.includes('127.0.0.1')) return true;

  const internalApi =
    config.get<string>('AFRICA_MEALS_API_INTERNAL_BASE_URL')?.trim().toLowerCase() ??
    '';
  if (internalApi.includes('api-dev.')) return true;

  return false;
}

function localPort(config: ConfigService, key: string, fallback: string): string {
  return String(config.get<string>(key) ?? fallback).trim() || fallback;
}

function isLocalhostUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

function isProductionProbeHost(url: string): boolean {
  try {
    return PROD_HOSTS.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function normalizeAdminHealthUrl(url: string): string {
  const base = url.replace(/\/+$/, '').replace(/\/api\/health$/, '');
  return `${base}/api/health`;
}

/** URL publique du dashboard admin (affichage statut / System Exchange). */
export function resolveAdminPublicUrl(config: ConfigService): string {
  const africaMeals = config.get<string>('AFRICA_MEALS_ADMIN_PUBLIC_URL')?.trim();
  if (africaMeals) return africaMeals.replace(/\/+$/, '');

  const adminApp = config.get<string>('ADMIN_APP_URL')?.trim();
  if (adminApp) return adminApp.replace(/\/+$/, '');

  const probeUrl = config.get<string>('STATUS_PROBE_ADMIN_URL')?.trim();
  if (probeUrl) {
    return probeUrl.replace(/\/+$/, '').replace(/\/api\/health$/, '');
  }

  if (isDevStatusProbeStack(config)) {
    const port = localPort(config, 'PM2_ADMIN_DEV_PORT', '3001');
    return `http://localhost:${port}`;
  }

  return 'https://admin.wise-eat.com';
}

const K8S_WS_GRPC_HOST = 'africa-meals-ws.wise-eat.svc.cluster.local';
const K8S_API_GRPC_HOST = 'africa-meals-api.wise-eat.svc.cluster.local';

function isGrpcInternalHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0') return true;
  if (h.includes('.svc.cluster.local') || h === 'host.k3s.internal') return true;
  return false;
}

function hostFromInternalServiceUrl(raw: string | undefined): string | null {
  const url = raw?.trim();
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    return isGrpcInternalHost(host) ? host : null;
  } catch {
    return null;
  }
}

/** Hôte gRPC WS pour sondes (jamais l’URL publique ws.wise-eat.com — port 50051 non exposé). */
export function resolveGrpcWsProbeHost(config: ConfigService): string {
  const configured = config.get<string>('GRPC_WS_HOST')?.trim();
  if (configured && isGrpcInternalHost(configured)) {
    return configured;
  }
  const fromWsInternal = hostFromInternalServiceUrl(
    config.get<string>('AFRICA_MEALS_WS_INTERNAL_URL'),
  );
  if (fromWsInternal) return fromWsInternal;
  if (!isDevStatusProbeStack(config)) return K8S_WS_GRPC_HOST;
  return configured || '127.0.0.1';
}

export function resolveGrpcWsDisplayEndpoint(config: ConfigService): string {
  const port = localPort(config, 'GRPC_WS_PORT', '50051');
  return `${resolveGrpcWsProbeHost(config)}:${port}`;
}

/** Hôte gRPC API pour sondes depuis le pod API (bind 0.0.0.0 → loopback). */
export function resolveGrpcApiProbeHost(config: ConfigService): string {
  const bind = config.get<string>('GRPC_API_BIND_HOST')?.trim();
  if (bind && bind !== '0.0.0.0' && isGrpcInternalHost(bind)) {
    return bind;
  }
  return '127.0.0.1';
}

export function resolveGrpcApiDisplayEndpoint(config: ConfigService): string {
  const port = localPort(config, 'GRPC_API_PORT', '50052');
  if (!isDevStatusProbeStack(config)) {
    return `${K8S_API_GRPC_HOST}:${port}`;
  }
  return `${resolveGrpcApiProbeHost(config)}:${port}`;
}

export function resolveWebProbeUrl(config: ConfigService): string {
  const direct = config.get<string>('STATUS_PROBE_WEB_URL')?.trim();

  if (isDevStatusProbeStack(config)) {
    if (direct && !isProductionProbeHost(direct)) return direct;
    const port = localPort(config, 'PM2_WEB_DEV_PORT', '5002');
    if (direct && isLocalhostUrl(direct)) return direct;
    return `http://localhost:${port}/`;
  }

  if (direct) return direct;
  return 'https://wise-eat.com/';
}

export function resolveWebProbeEndpointUrl(config: ConfigService): string {
  if (isDevStatusProbeStack(config)) {
    return DEV_WEB_URL;
  }
  return resolveWebProbeUrl(config);
}

function isK8sInternalServiceUrl(url: string): boolean {
  try {
    return new URL(url).hostname.includes('.svc.cluster.local');
  } catch {
    return false;
  }
}

/** URL HTTP utilisée pour sonder le WS (localhost en dev, service k8s en prod). */
export function resolveWsProbeFetchUrl(config: ConfigService): string {
  const wsInternal = config
    .get<string>('AFRICA_MEALS_WS_INTERNAL_URL')
    ?.trim()
    ?.replace(/\/+$/, '');
  if (wsInternal && isLocalhostUrl(wsInternal)) {
    return `${wsInternal}/api/health`;
  }

  if (isDevStatusProbeStack(config)) {
    const port = localPort(config, 'PM2_WS_DEV_PORT', '8001');
    return `http://localhost:${port}/api/health`;
  }

  if (wsInternal && isK8sInternalServiceUrl(wsInternal)) {
    return `${wsInternal}/api/health`;
  }

  const base = config.get<string>('WS_BASE_URL')?.trim()?.replace(/\/+$/, '');
  if (base) return `${base}/api/health`;
  if (wsInternal) return `${wsInternal}/api/health`;
  return 'https://ws.wise-eat.com/api/health';
}

/** URL affichée dans le payload SSE (tunnel dev public ou WS_BASE_URL prod). */
export function resolveWsProbeEndpointUrl(config: ConfigService): string {
  if (isDevStatusProbeStack(config)) {
    return `${DEV_WS_PUBLIC}/api/health`;
  }
  const base = config.get<string>('WS_BASE_URL')?.trim()?.replace(/\/+$/, '');
  if (base) return `${base}/api/health`;
  return resolveWsProbeFetchUrl(config);
}

/** URL HTTP pour sonder l’admin (localhost en dev). */
export function resolveAdminProbeHealthUrl(config: ConfigService): string {
  if (isDevStatusProbeStack(config)) {
    const direct = config.get<string>('STATUS_PROBE_ADMIN_URL')?.trim();
    if (direct && isLocalhostUrl(direct)) {
      return normalizeAdminHealthUrl(direct);
    }
    const port = localPort(config, 'PM2_ADMIN_DEV_PORT', '3001');
    return `http://localhost:${port}/api/health`;
  }

  const direct = config.get<string>('STATUS_PROBE_ADMIN_URL')?.trim();
  if (direct) return normalizeAdminHealthUrl(direct);

  return 'https://admin.wise-eat.com/api/health';
}

/** URL affichée dans le payload SSE (tunnel dev public). */
export function resolveAdminProbeEndpointUrl(config: ConfigService): string {
  if (isDevStatusProbeStack(config)) {
    const direct = config.get<string>('STATUS_PROBE_ADMIN_URL')?.trim();
    if (direct && isLocalhostUrl(direct)) {
      return DEV_ADMIN_HEALTH;
    }
    return DEV_ADMIN_HEALTH;
  }
  return resolveAdminProbeHealthUrl(config);
}
