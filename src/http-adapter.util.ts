export type ApiHttpAdapter = 'fastify' | 'express';
export type ApiHttpAdapterMode = ApiHttpAdapter | 'both';

const SUPPORTED_HTTP_ADAPTER_MODES = new Set<ApiHttpAdapterMode>([
  'fastify',
  'express',
  'both',
]);

/**
 * Valide le mode demandé puis fixe l’adaptateur réel avant le chargement d’AppModule.
 * `both` laisse chaque bootstrap choisir son runtime natif : Fastify serveur, Express Firebase.
 */
export function configureHttpAdapterForRuntime(
  runtimeAdapter: ApiHttpAdapter,
): ApiHttpAdapter {
  const rawMode = String(process.env.API_HTTP_ADAPTER ?? 'both')
    .trim()
    .toLowerCase();

  if (!SUPPORTED_HTTP_ADAPTER_MODES.has(rawMode as ApiHttpAdapterMode)) {
    throw new Error(
      `API_HTTP_ADAPTER="${rawMode}" invalide : utiliser fastify, express ou both.`,
    );
  }

  const mode = rawMode as ApiHttpAdapterMode;
  if (mode !== 'both' && mode !== runtimeAdapter) {
    throw new Error(
      `API_HTTP_ADAPTER="${mode}" désactive le bootstrap ${runtimeAdapter}. ` +
        'Utiliser "both" pour Fastify serveur + Express Firebase.',
    );
  }

  // AppModule construit GraphQL au chargement : ce marqueur doit refléter
  // l’adaptateur réellement instancié, jamais une valeur héritée du déploiement.
  process.env.API_HTTP_ADAPTER = runtimeAdapter;
  return runtimeAdapter;
}

/** Retourne l’adaptateur déjà résolu par le bootstrap courant. */
export function isFastifyHttpAdapter(): boolean {
  return process.env.API_HTTP_ADAPTER === 'fastify';
}
