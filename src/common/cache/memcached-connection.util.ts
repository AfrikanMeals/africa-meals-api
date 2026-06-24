import { ConfigService } from '@nestjs/config';
import { parsePositiveInt } from '../redis/redis-connection.util';

function toBool(raw: string | undefined): boolean {
  const v = (raw ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export type MemcachedTlsConfig = {
  host: string;
  port: number;
  servername: string;
  rejectUnauthorized: boolean;
  timeoutMs: number;
};

export type MemcachedConnectionConfig = {
  servers: string;
  tls?: MemcachedTlsConfig;
};

function parseFirstServer(servers: string): { host: string; port: number } | null {
  const first = servers.split(',')[0]?.trim();
  if (!first) return null;
  const match = /^([^:/]+):(\d+)$/.exec(first);
  if (!match) return null;
  return { host: match[1], port: Number.parseInt(match[2], 10) };
}

export function resolveMemcachedServersFromGetter(
  get: (key: string) => string | undefined,
): string | null {
  const direct =
    get('MEMCACHED_SERVERS')?.trim() || get('MEMCACHED_URL')?.trim();
  if (direct) return direct;
  const host = get('MEMCACHED_HOST')?.trim();
  if (!host) return null;
  const port = get('MEMCACHED_PORT')?.trim() || '11211';
  return `${host}:${port}`;
}

export function resolveMemcachedServersFromConfig(
  config: ConfigService | { get: (key: string) => string | undefined },
): string | null {
  return resolveMemcachedServersFromGetter((key) => config.get(key));
}

export function readMemcachedConnectionFromConfig(
  config: ConfigService | { get: (key: string) => string | undefined },
): MemcachedConnectionConfig | null {
  const servers = resolveMemcachedServersFromConfig(config);
  if (!servers) return null;
  const tlsEnabled = toBool(config.get('MEMCACHED_TLS'));
  if (!tlsEnabled) {
    return { servers };
  }
  const first = parseFirstServer(servers);
  if (!first) return null;
  const rejectRaw = config.get('MEMCACHED_TLS_REJECT_UNAUTHORIZED')
    ?.trim()
    .toLowerCase();
  const rejectUnauthorized =
    rejectRaw !== 'false' && rejectRaw !== '0' && rejectRaw !== 'no';
  const servername =
    config.get('MEMCACHED_TLS_SERVERNAME')?.trim() || first.host;
  const timeoutMs = parsePositiveInt(
    config.get('MEMCACHED_CONNECT_TIMEOUT_MS'),
    5000,
  );
  return {
    servers,
    tls: {
      host: first.host,
      port: first.port,
      servername,
      rejectUnauthorized,
      timeoutMs,
    },
  };
}
