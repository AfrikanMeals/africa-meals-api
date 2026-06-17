/** Seeds démo / catalogue — jamais en production (L-04). */
export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function isDemoSeedEnvEnabled(flagName: string): boolean {
  if (isProductionRuntime()) {
    return false;
  }
  return process.env[flagName]?.trim().toLowerCase() === 'true';
}

/** Catalogue mock (`SeedService`) — opt-in explicite hors prod. */
export function isCatalogSeedEnabled(): boolean {
  return isDemoSeedEnvEnabled('ENABLE_CATALOG_SEED');
}

export function getDemoSeedPassword(): string {
  const fromEnv = process.env.DEMO_SEED_PASSWORD?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return 'SeedPassword123!';
}
