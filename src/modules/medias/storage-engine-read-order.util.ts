import type { StorageEngineId } from './storage-engine.types';

/**
 * Ordre de repli lecture proxy après le moteur admin / pool.
 * Cloud credentials (Firebase → GCS → S3 → R2) avant MinIO local :
 * un ECONNREFUSED MinIO ne doit pas masquer un objet encore sur GCS/S3/R2.
 */
export const STORAGE_READ_FALLBACK_ORDER: readonly StorageEngineId[] = [
  'firebase',
  'gcs',
  's3',
  'r2',
  'vercelBlob',
  'minio',
] as const;

/**
 * Ordonne les moteurs pour `GET /medias/public/…`.
 * Pure : testable sans Nest ; le factory ne fait que résoudre les instances.
 */
export function orderStorageEnginesForRead(args: {
  primaryId: StorageEngineId;
  pool?: readonly StorageEngineId[] | null;
  /** Ids configurés + activés (intersection déjà faite par le caller). */
  candidateIds: readonly StorageEngineId[];
}): StorageEngineId[] {
  const allowed = new Set(args.candidateIds);
  const seen = new Set<StorageEngineId>();
  const ordered: StorageEngineId[] = [];

  const push = (id: StorageEngineId | undefined | null): void => {
    if (!id || !allowed.has(id) || seen.has(id)) return;
    seen.add(id);
    ordered.push(id);
  };

  // 1. Moteur effectif admin (mode + pool random résolu en amont).
  push(args.primaryId);
  // 2. Pool déclaré (objets récents souvent sur ces moteurs).
  for (const id of args.pool ?? []) {
    push(id);
  }
  // 3. Repli cloud stable, puis MinIO.
  for (const id of STORAGE_READ_FALLBACK_ORDER) {
    push(id);
  }
  // 4. Tout candidat restant (sécurité forward-compat).
  for (const id of args.candidateIds) {
    push(id);
  }
  return ordered;
}
