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
      /^(127\.0\.0\.1|localhost)(:27017)?$/.test(h) ||
      h === '127.0.0.1' ||
      h === 'localhost'
    );
  });
}

function isStunnelRemoteHost(hostPart: string): boolean {
  return (
    hostPart.includes('db.wise-eat.com') || /(^|,)[^:]+:27018($|,)/.test(hostPart)
  );
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
  const local = isSelfHostedLocalHost(hostPart);
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
}
