/**
 * Règles proxy médias vs moteurs privés (GCS PAP).
 * Isolé pour tests sans Nest.
 */

/** Vrai si le pool d’upload inclut GCS (bucket privé / PAP). */
export function storagePoolRequiresMediaProxy(
  pool: readonly string[] | null | undefined,
): boolean {
  if (!Array.isArray(pool) || pool.length === 0) return false;
  return pool.some(
    (id) =>
      String(id ?? '')
        .trim()
        .toLowerCase() === 'gcs',
  );
}

/**
 * Force le proxy ON quand GCS est dans le pool (lecture anonyme interdite).
 * Sinon conserve la valeur demandée.
 */
export function resolveMediaProxyEnabledForPool(args: {
  requested: boolean;
  storageEnginePool: readonly string[];
}): boolean {
  if (storagePoolRequiresMediaProxy(args.storageEnginePool)) return true;
  return args.requested === true;
}
