import { ConfigService } from '@nestjs/config';

/**
 * Options de connexion MongoDB partagées par `AppModule`.
 *
 * Sur Atlas M0, la limite est ~500 connexions **cluster** : chaque réplica API/WS
 * ou chaque instance Cloud Functions a son **propre** pool. Il faut donc garder
 * `maxPoolSize` modeste et limiter `FUNCTION_MAX_INSTANCES` en prod.
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

  const rawMax = Number(config.get<string>('MONGOOSE_MAX_POOL') ?? 5);
  const maxPoolSize = Number.isFinite(rawMax)
    ? Math.max(1, Math.min(50, rawMax))
    : 5;

  const rawMin = Number(config.get<string>('MONGOOSE_MIN_POOL') ?? 0);
  const minPoolSize = Number.isFinite(rawMin)
    ? Math.max(0, Math.min(maxPoolSize, rawMin))
    : 0;

  return {
    uri,
    ...(dbName ? { dbName } : {}),
    maxPoolSize,
    minPoolSize,
    maxIdleTimeMS: Number(
      config.get<string>('MONGOOSE_MAX_IDLE_MS') || 60_000,
    ),
    serverSelectionTimeoutMS: Number(
      config.get<string>('MONGOOSE_SERVER_SELECTION_MS') || 8000,
    ),
    waitQueueTimeoutMS: Number(
      config.get<string>('MONGOOSE_WAIT_QUEUE_MS') || 10_000,
    ),
  };
}
