import { ConfigService } from '@nestjs/config';
import {
  normalizeMongoUriForDriver,
  readMongoIpFamily,
  warnMongoUriReplicaSetConfig,
} from './mongoose-uri-diagnostics';

/** Vrai si l’URI contient déjà un nom de base (`…/african_meals_db?…`). */
function mongoUriHasDatabase(uri: string): boolean {
  const afterAt = uri.split('@')[1];
  if (!afterAt) return false;
  const slash = afterAt.indexOf('/');
  if (slash < 0) return false;
  const segment = afterAt
    .slice(slash + 1)
    .split('?')[0]
    ?.split('/')[0]
    ?.trim();
  return Boolean(segment && segment.length > 0);
}

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
 * **Défaut `maxPoolSize`** : assez haut pour éviter `MongoWaitQueueTimeoutError` en dev
 * (Nest watch + mobile + agrégations), tout en laissant `MONGOOSE_MAX_POOL` surcharger.
 * Sur Atlas, vérifier le plafond de connexions du tier ; baisser le pool si plusieurs services
 * partagent le même cluster.
 *
 * Autres réglages utiles :
 * - `minPoolSize` à 0 : pas de connexions « au chaud » inutiles
 * - `maxIdleTimeMS` : fermeture des sockets inactives dans le pool
 * - `waitQueueTimeoutMS` : temps max en file d’attente d’une socket du pool
 * - `socketTimeoutMS` : limite la durée d’une opération sur une socket
 * - `enableShutdownHooks()` côté Nest (`main.ts`) pour couper proprement au SIGTERM
 */
export function buildMongooseRootOptions(
  config: ConfigService,
  defaultAppName: string,
) {
  const fullUri =
    config.get<string>('MONGODB_URI') || config.get<string>('MONGO_URI') || '';
  const user = encodeURIComponent(config.get<string>('DB_USERNAME') ?? '');
  const pass = encodeURIComponent(config.get<string>('DB_PASSWORD') ?? '');
  const host = (config.get<string>('DB_HOST') ?? '').trim();
  const appName = encodeURIComponent(
    config.get<string>('MONGODB_APP_NAME') || defaultAppName,
  );
  const dbName = (config.get<string>('DB_DATABASE') ?? '').trim();
  const builtUri =
    user && pass && host
      ? `mongodb+srv://${user}:${pass}@${host}/${
          dbName ? `${encodeURIComponent(dbName)}?` : '?'
        }retryWrites=true&w=majority&appName=${appName}`
      : '';

  const rawUri = fullUri.trim() || builtUri;
  const uri = normalizeMongoUriForDriver(rawUri);
  warnMongoUriReplicaSetConfig(uri, defaultAppName);
  const dbInUri = mongoUriHasDatabase(uri);
  const ipFamily = readMongoIpFamily((key) => config.get(key));

  const maxPoolSize = parsePositiveInt(
    config.get<string>('MONGOOSE_MAX_POOL'),
    20,
    100,
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
    30_000,
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
    3,
    8,
  );

  return {
    uri,
    ...(!dbInUri && dbName ? { dbName } : {}),
    ...(ipFamily != null ? { family: ipFamily } : {}),
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
