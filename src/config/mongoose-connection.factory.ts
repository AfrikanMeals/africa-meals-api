import { ConfigService } from '@nestjs/config';

function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  max?: number,
): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return max != null ? Math.min(max, Math.floor(n)) : Math.floor(n);
}

/**
 * Options de connexion MongoDB partagées par `AppModule`.
 *
 * Sur Atlas, la métrique « Connections » sur un nœud = **somme de tous les clients**
 * (API, WS, Functions, shells, etc.) : chaque processus a son **pool** (`maxPoolSize`).
 * Ex. 20 réplicas × 10 connexions max = 200 : proche d’un plafond Atlas (ex. 216).
 * Garder `MONGOOSE_MAX_POOL` **bas** si plusieurs services (API, WS, scripts) pointent sur le même cluster.
 *
 * Pour **minimiser** les sockets ouvertes :
 * - `maxPoolSize` bas (3–8 par instance Cloud Run / API)
 * - `minPoolSize` à 0 (pas de connexions « au chaud » inutiles)
 * - `maxIdleTimeMS` modéré : le pilote ferme les connexions inactives du pool
 * - `socketTimeoutMS` : évite les opérations bloquées indéfiniment
 * - `enableShutdownHooks()` côté Nest (voir `main.ts`) pour couper proprement au SIGTERM
 */
export function buildMongooseRootOptions(
  config: ConfigService,
  defaultAppName: string,
) {
  const fullUri =
    config.get<string>('MONGODB_URI') ||
    config.get<string>('MONGO_URI') ||
    '';
  const builtUri = `mongodb+srv://${config.get<string>(
    'DB_USERNAME',
  )}:${config.get<string>('DB_PASSWORD')}@${config.get<string>(
    'DB_HOST',
  )}?retryWrites=true&w=majority&appName=${encodeURIComponent(
    config.get<string>('MONGODB_APP_NAME') || defaultAppName,
  )}`;

  const uri = fullUri || builtUri;
  const dbName = config.get<string>('DB_DATABASE');

  const maxPoolSize = parsePositiveInt(
    config.get<string>('MONGOOSE_MAX_POOL'),
    5,
    12,
  );

  const minPoolSize = Math.min(
    maxPoolSize,
    parsePositiveInt(config.get<string>('MONGOOSE_MIN_POOL'), 0, maxPoolSize),
  );

  const maxIdleTimeMS = parsePositiveInt(
    config.get<string>('MONGOOSE_MAX_IDLE_MS'),
    45_000,
    600_000,
  );

  const serverSelectionTimeoutMS = parsePositiveInt(
    config.get<string>('MONGOOSE_SERVER_SELECTION_MS'),
    8000,
    120_000,
  );

  const waitQueueTimeoutMS = parsePositiveInt(
    config.get<string>('MONGOOSE_WAIT_QUEUE_MS'),
    10_000,
    120_000,
  );

  const socketTimeoutMS = parsePositiveInt(
    config.get<string>('MONGOOSE_SOCKET_TIMEOUT_MS'),
    45_000,
    300_000,
  );

  const heartbeatFrequencyMS = parsePositiveInt(
    config.get<string>('MONGOOSE_HEARTBEAT_FREQ_MS'),
    30_000,
    120_000,
  );

  const maxConnecting = parsePositiveInt(
    config.get<string>('MONGOOSE_MAX_CONNECTING'),
    2,
    5,
  );

  return {
    uri,
    ...(dbName ? { dbName } : {}),
    maxPoolSize,
    minPoolSize,
    maxIdleTimeMS,
    serverSelectionTimeoutMS,
    waitQueueTimeoutMS,
    socketTimeoutMS,
    heartbeatFrequencyMS,
    maxConnecting,
  };
}
