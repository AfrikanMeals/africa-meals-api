/**
 * Règles proxy médias vs moteurs privés (GCS PAP / S3 Block Public Access).
 * Isolé pour tests sans Nest.
 */

/**
 * Moteurs dont la lecture anonyme est interdite en prod → proxy `/medias/public/…`
 * obligatoire dès qu’ils sont dans le pool d’upload.
 * R2 endpoint S3-compatible n’est pas public sans `R2_PUBLIC_BASE_URL`.
 */
const PRIVATE_POOL_ENGINES = new Set(['gcs', 's3', 'r2', 'vercelBlob']);

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
