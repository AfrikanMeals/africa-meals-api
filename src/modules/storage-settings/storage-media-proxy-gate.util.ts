/**
 * Règles proxy médias vs moteurs privés (GCS PAP / S3 Block Public Access).
 * Isolé pour tests sans Nest.
 */

/** Moteurs dont le bucket est privé en production → proxy `/medias/public/…` obligatoire. */
const PRIVATE_POOL_ENGINES = new Set(['gcs', 's3']);

/** Vrai si le pool d’upload inclut GCS ou S3 (lecture anonyme interdite). */
export function storagePoolRequiresMediaProxy(
  pool: readonly string[] | null | undefined,
): boolean {
  if (!Array.isArray(pool) || pool.length === 0) return false;
  return pool.some((id) =>
    PRIVATE_POOL_ENGINES.has(
      String(id ?? '')
        .trim()
        .toLowerCase(),
    ),
  );
}

/**
 * Force le proxy ON quand GCS ou S3 est dans le pool (lecture anonyme interdite).
 * Sinon conserve la valeur demandée.
 */
export function resolveMediaProxyEnabledForPool(args: {
  requested: boolean;
  storageEnginePool: readonly string[];
}): boolean {
  if (storagePoolRequiresMediaProxy(args.storageEnginePool)) return true;
  return args.requested === true;
}
