import { Logger } from '@nestjs/common';

const log = new Logger('MongoUri');

function mongoUriQuery(uri: string): URLSearchParams {
  const q = uri.indexOf('?');
  return new URLSearchParams(q >= 0 ? uri.slice(q + 1) : '');
}

function mongoUriHostPart(uri: string): string {
  const match = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@]*@)?([^/?]+)/i);
  return match?.[1]?.toLowerCase() ?? '';
}

function isTruthyParam(params: URLSearchParams, key: string): boolean {
  const value = params.get(key)?.trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

function isAtlasUri(uri: string): boolean {
  if (/^mongodb\+srv:\/\//i.test(uri)) {
    return true;
  }
  return mongoUriHostPart(uri).includes('mongodb.net');
}

function isSelfHostedLocalHost(hostPart: string): boolean {
  return hostPart.split(',').some((host) => {
    const h = host.trim();
    return (
      /^(127\.0\.0\.1|localhost)(:27017|:27027|:27028)?$/.test(h) ||
      h === '127.0.0.1' ||
      h === 'localhost'
    );
  });
}

/** VPS rs0 local ou pods k8s via host.k3s.internal:27017|27027|27028 (pas Stunnel :27018). */
function isMongoLocalReplicaUri(hostPart: string): boolean {
  if (isSelfHostedLocalHost(hostPart)) return true;
  return (
    hostPart.includes('host.k3s.internal') &&
    /:270(17|27|28)(,|$)/.test(hostPart) &&
    !/:27018/.test(hostPart)
  );
}

function isStunnelRemoteHost(hostPart: string): boolean {
  if (isMongoLocalReplicaUri(hostPart)) return false;
  return (
    hostPart.includes('db.wise-eat.com') ||
    (hostPart.includes('host.k3s.internal') && /:27018/.test(hostPart)) ||
    /(^|,)[^:]+:27018($|,)/.test(hostPart)
  );
}

/** SNI TLS Stunnel quand l’URI pointe host.k3s.internal (cert LE = db.wise-eat.com). */
export function readMongoTlsServername(
  uri: string,
  get: (key: string) => string | undefined = (key) => process.env[key],
): string | undefined {
  if (isAtlasUri(uri)) return undefined;
  const hostPart = mongoUriHostPart(uri);
  if (isMongoLocalReplicaUri(hostPart)) return undefined;
  const explicit = get('MONGODB_TLS_SERVERNAME')?.trim();
  if (explicit) return explicit;
  if (!isStunnelRemoteHost(hostPart)) return undefined;
  if (
    hostPart.includes('host.k3s.internal') ||
    isSelfHostedLocalHost(hostPart)
  ) {
    return 'db.wise-eat.com';
  }
  return undefined;
}

/**
 * Corrige les URI Stunnel (`db.wise-eat.com:27018`) : TLS + directConnection,
 * sans replicaSet (les hôtes Docker du rs0 ne sont pas joignables depuis le Mac).
 */
export function normalizeMongoUriForDriver(uri: string): string {
  const trimmed = uri.trim();
  if (!trimmed || isAtlasUri(trimmed)) {
    return trimmed;
  }
  const hostPart = mongoUriHostPart(trimmed);
  if (!isStunnelRemoteHost(hostPart)) {
    return trimmed;
  }

  const q = trimmed.indexOf('?');
  const base = q >= 0 ? trimmed.slice(0, q) : trimmed;
  const params = mongoUriQuery(trimmed);
  params.set('tls', 'true');
  params.set('directConnection', 'true');
  params.delete('replicaSet');

  const normalized = `${base}?${params.toString()}`;
  if (
    normalized !== trimmed &&
    process.env.MONGODB_URI_DIAGNOSTICS !== '0'
  ) {
    log.log(
      'MONGODB_URI ajustée pour Stunnel (tls=true, directConnection=true, replicaSet retiré).',
    );
  }
  return normalized;
}

export function readMongoIpFamily(
  get: (key: string) => string | undefined = (key) => process.env[key],
): 4 | 6 | undefined {
  const raw =
    get('MONGODB_IP_FAMILY')?.trim() || get('REDIS_IP_FAMILY')?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  if (n === 4 || n === 6) return n;
  return undefined;
}

/**
 * Avertissements au bootstrap si l’URI MongoDB n’est pas adaptée au replica set VPS.
 * Atlas (`mongodb+srv`) : aucun contrôle (découverte automatique).
 */
export function warnMongoUriReplicaSetConfig(
  uri: string,
  serviceName: string,
): void {
  const trimmed = uri.trim();
  if (!trimmed || process.env.MONGODB_URI_DIAGNOSTICS === '0') {
    return;
  }
  if (isAtlasUri(trimmed)) {
    return;
  }

  const params = mongoUriQuery(trimmed);
  const hostPart = mongoUriHostPart(trimmed);
  const directConnection = isTruthyParam(params, 'directConnection');
  const replicaSet = params.get('replicaSet')?.trim();
  const local = isMongoLocalReplicaUri(hostPart);
  const stunnel = isStunnelRemoteHost(hostPart);
  const isProd = process.env.NODE_ENV === 'production';
  const tag = `[${serviceName}]`;

  if (local && !replicaSet) {
    log.warn(
      `${tag} MONGODB_URI self-hosted sans replicaSet — ajoutez replicaSet=rs0 pour la bascule primary/réplicas (PM2 sur VPS).`,
    );
  }

  if (local && directConnection) {
    log.warn(
      `${tag} directConnection=true sur 127.0.0.1 — pas de découverte replica set ; préférez replicaSet=rs0 sans directConnection.`,
    );
  }

  if (stunnel && directConnection) {
    log.warn(
      `${tag} MONGODB_URI via Stunnel (directConnection=true) : un seul nœud, pas de failover côté client.${
        isProd
          ? ' En prod sur le VPS, utilisez 127.0.0.1:27017?authSource=admin&replicaSet=rs0.'
          : ' OK pour migration/admin ; sur le VPS, préférez l’URI locale pour l’API/WS.'
      }`,
    );
  }

  if (stunnel && !directConnection && !replicaSet) {
    log.warn(
      `${tag} MONGODB_URI distante (Stunnel) sans directConnection ni replicaSet — utilisez directConnection=true (admin/migration) ou l’URI locale avec replicaSet=rs0 (PM2).`,
    );
  }

  if (stunnel && replicaSet && !directConnection) {
    log.warn(
      `${tag} MONGODB_URI Stunnel avec replicaSet=${replicaSet} — découverte rs0 impossible via un seul endpoint (risque ECONNRESET).`,
    );
  }
}
