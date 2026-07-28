import type { StorageEngineId } from './storage-engine.types';

/** Lecture d'environnement découplée de `ConfigService` (logique testable sans Nest). */
export type StorageEnvReader = (key: string) => string | undefined;

export type AclEngineEnvKey =
  | 'GCS_PUBLIC_READ'
  | 'AWS_S3_PUBLIC_READ'
  | 'MINIO_PUBLIC_READ';

/** Clé env d'ACL objet `public-read` par moteur (moteurs sans ACL objet absents). */
const ACL_ENV_KEYS: Partial<Record<StorageEngineId, AclEngineEnvKey>> = {
  gcs: 'GCS_PUBLIC_READ',
  s3: 'AWS_S3_PUBLIC_READ',
  minio: 'MINIO_PUBLIC_READ',
};

/** Moteurs dont le bucket est privé par défaut côté fournisseur → ACL en opt-in. */
const OPT_IN_ACL_ENGINES: ReadonlySet<StorageEngineId> = new Set([
  // AWS active « Block all public access » sur tout nouveau bucket depuis 2023.
  's3',
  // GCS applique Public Access Prevention par défaut sur les projets récents.
  'gcs',
]);

/** Domaine CDN/custom servant les objets même quand le bucket est privé. */
const CDN_BASE_URL_ENV_KEYS: Partial<Record<StorageEngineId, string>> = {
  s3: 'AWS_S3_PUBLIC_BASE_URL',
  minio: 'MINIO_PUBLIC_BASE_URL',
  r2: 'R2_PUBLIC_BASE_URL',
};

const FALSY = new Set(['false', '0', 'no', 'off']);
const TRUTHY = new Set(['true', '1', 'yes', 'on']);

function normalize(raw: string | undefined): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase();
}

function isExplicitlyDisabled(raw: string | undefined): boolean {
  return FALSY.has(normalize(raw));
}

function isExplicitlyEnabled(raw: string | undefined): boolean {
  return TRUTHY.has(normalize(raw));
}

function hasValue(raw: string | undefined): boolean {
  return String(raw ?? '').trim().length > 0;
}

/**
 * Faut-il tenter un `PutObject` avec `ACL: 'public-read'` sur ce moteur ?
 *
 * S3 et GCS sont en **opt-in explicite** : leurs buckets sont privés par défaut
 * (Block all public access / Public Access Prevention) et une ACL publique y est
 * refusée. Sans opt-in, S3 renvoyait `AccessDenied` puis retentait sans ACL —
 * soit deux `PutObject` facturés à chaque upload.
 *
 * MinIO garde le comportement historique (activé sauf `MINIO_PUBLIC_READ=false`) :
 * l'infra ouvre le bucket en lecture avec `mc anonymous set download`.
 */
export function isObjectAclRequested(
  engine: StorageEngineId,
  env: StorageEnvReader,
): boolean {
  const aclKey = ACL_ENV_KEYS[engine];
  // Firebase (URL à token) et R2 (pas d'ACL objet) n'envoient jamais d'ACL.
  if (!aclKey) return false;
  // Kill switch global : bucket policy / UBLA gérés hors application.
  if (isExplicitlyDisabled(env('STORAGE_OBJECT_ACL'))) return false;

  const raw = env(aclKey);
  if (OPT_IN_ACL_ENGINES.has(engine)) return isExplicitlyEnabled(raw);
  return !isExplicitlyDisabled(raw);
}

/**
 * Une URL bucket **directe** est-elle encore lisible par un client anonyme ?
 *
 * Garde-fou « Block all public access » : quand la réponse est `false`, servir une
 * URL directe renverrait 403 sur mobile / admin / web, et le média doit passer par
 * le proxy `GET /medias/public/…` (voir `MediasService.resolvePublicMediaUrl`).
 *
 * Un domaine CDN dédié (CloudFront + OAC, Cloudflare, MinIO public) reste lisible
 * bucket privé : il prime sur l'état de l'ACL.
 */
export function isDirectPublicReadAvailable(
  engine: StorageEngineId,
  env: StorageEnvReader,
): boolean {
  const cdnKey = CDN_BASE_URL_ENV_KEYS[engine];
  if (cdnKey && hasValue(env(cdnKey))) return true;

  switch (engine) {
    // URLs signées par token de téléchargement : indépendantes de l'ACL bucket.
    case 'firebase':
      return true;
    // Bucket privé / Public Access Prevention : toujours proxifié, y compris quand
    // `GCS_PUBLIC_READ` est activé pour les ACL (comportement historique figé).
    case 'gcs':
      return false;
    // Bascule « Block all public access » : opt-in explicite requis.
    case 's3':
      return (
        !isExplicitlyDisabled(env('STORAGE_OBJECT_ACL')) &&
        isExplicitlyEnabled(env('AWS_S3_PUBLIC_READ'))
      );
    // MinIO auto-hébergé : bucket ouvert en lecture par l'infra.
    case 'minio':
      return (
        !isExplicitlyDisabled(env('STORAGE_OBJECT_ACL')) &&
        !isExplicitlyDisabled(env('MINIO_PUBLIC_READ'))
      );
    // R2 : l’endpoint `*.r2.cloudflarestorage.com` n’est pas anonyme.
    // Sans `R2_PUBLIC_BASE_URL` (déjà géré via CDN_BASE_URL_ENV_KEYS) → proxy.
    case 'r2':
      return false;
    // Vercel Blob private store : URL `*.private.blob.vercel-storage.com` non anonyme.
    case 'vercelBlob':
      return false;
    default:
      return true;
  }
}
