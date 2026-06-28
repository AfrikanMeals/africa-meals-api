import type { ConfigService } from '@nestjs/config';
import type { IClientOptions } from 'mqtt';
import { isIP } from 'node:net';
import {
  checkServerIdentity as tlsCheckServerIdentity,
  type ConnectionOptions,
} from 'node:tls';

type MqttTlsClientOptions = IClientOptions &
  Pick<ConnectionOptions, 'checkServerIdentity'>;

function resolveHostToIp(hostname: string): string | undefined {
  if (isIP(hostname) !== 0) return hostname;
  try {
    const { lookupSync } = require('node:dns') as {
      lookupSync: (
        host: string,
        options: { verbatim: true },
      ) => { address: string; family: number };
    };
    return lookupSync(hostname, { verbatim: true }).address;
  } catch {
    return undefined;
  }
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  return fallback;
}

/** Lit MQTT_BROKER_* et applique les options TLS (SNI) pour mqtts:// / wss://. */
export function readMqttBrokerConfig(config: ConfigService): {
  url: string;
  options: IClientOptions;
} | null {
  const direct = config.get<string>('MQTT_BROKER_URL')?.trim();
  const host = config.get<string>('MQTT_BROKER_HOST')?.trim();
  if (!direct && !host) return null;

  const port = parsePositiveInt(config.get<string>('MQTT_BROKER_PORT'), 8883);
  const protocol =
    config.get<string>('MQTT_BROKER_PROTOCOL')?.trim() || 'mqtts';
  const url = direct || `${protocol}://${host}:${port}`;

  const options: MqttTlsClientOptions = {
    username: config.get<string>('MQTT_BROKER_USERNAME')?.trim(),
    password: config.get<string>('MQTT_BROKER_PASSWORD')?.trim(),
    connectTimeout: parsePositiveInt(
      config.get<string>('MQTT_CONNECT_TIMEOUT_MS'),
      8000,
    ),
    keepalive: parsePositiveInt(
      config.get<string>('MQTT_KEEPALIVE_SEC'),
      30,
    ),
    reconnectPeriod: parsePositiveInt(
      config.get<string>('MQTT_RECONNECT_MS'),
      2000,
    ),
  };

  const isTls = url.startsWith('mqtts://') || url.startsWith('wss://');
  if (isTls) {
    const tlsServername = config.get<string>('MQTT_BROKER_TLS_SERVERNAME')?.trim();
    let connectionHost = host;
    if (!connectionHost) {
      try {
        connectionHost = new URL(url).hostname;
      } catch {
        connectionHost = '';
      }
    }
    const servername = tlsServername || connectionHost;
    options.rejectUnauthorized = parseBoolean(
      config.get<string>('MQTT_TLS_REJECT_UNAUTHORIZED'),
      true,
    );
    if (servername) {
      options.servername = servername;
    }
    // mqtt.js v5 écrase servername par host si host n'est pas une IP (lib/connect/tls.js).
    if (
      tlsServername &&
      connectionHost &&
      tlsServername !== connectionHost
    ) {
      options.checkServerIdentity = (_hostname, cert) =>
        tlsCheckServerIdentity(tlsServername, cert);
      if (isIP(connectionHost) === 0) {
        const connectIp = resolveHostToIp(connectionHost);
        if (connectIp) {
          options.host = connectIp;
        }
      }
    }
  }

  return { url, options };
}
