import {
  DEFAULT_MODULE_ENGINES,
  type AppCacheModuleKey,
  type CacheEngine,
  type CacheEngineAvailability,
  type ModuleEngineMap,
} from '@common/cache/cache-engine.types';
import { createMemcachedStore } from '@common/cache/memcached-cache-store.util';
import { readMemcachedConnectionFromConfig } from '@common/cache/memcached-connection.util';
import {
  bustCacheKey,
  bustCacheKeysByPrefix,
  bustCartPricingCachesForUser,
  bustCatalogListingPublicCaches,
  bustProductDetailCachesForProduct,
  bustPublicCatalogAppCaches,
  bustAllRecommendationFeedCaches,
  bustRecommendationFeedCachesForUser,
  clearInflightCache,
  detectCacheStoreKind,
  getOrSetCache,
} from '@common/redis-app-cache';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cache, caching } from 'cache-manager';
import {
  readRedisCacheStoreOptionsFromConfig,
} from '@common/redis/redis-connection.util';

function memcachedServers(config: ConfigService): string | null {
  const direct =
    config.get<string>('MEMCACHED_SERVERS')?.trim() ||
    config.get<string>('MEMCACHED_URL')?.trim();
  if (direct) return direct;
  const host = config.get<string>('MEMCACHED_HOST')?.trim();
  if (!host) return null;
  const port = config.get<string>('MEMCACHED_PORT')?.trim() || '11211';
  return `${host}:${port}`;
}

function dedupeCaches(caches: Cache[]): Cache[] {
  return [...new Set(caches)];
}

@Injectable()
export class ModuleCacheLayerService implements OnModuleInit {
  private readonly _logger = new Logger(ModuleCacheLayerService.name);
  private _memoryCache: Cache | null = null;
  private _redisCache: Cache | null = null;
  private _memcachedCache: Cache | null = null;
  private _moduleEngines: ModuleEngineMap = { ...DEFAULT_MODULE_ENGINES };
  private _lastRedisEngineUp = false;
  private _redisRecoveryPending = false;

  constructor(
    @Inject(CACHE_MANAGER)
    private readonly _defaultCache: Cache,
    private readonly _config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this._bootstrapStores();
    this._lastRedisEngineUp = await this.probeRedisEngine();
  }

  /** Ping moteur Redis dédié (pas le fallback mémoire). */
  async probeRedisEngine(): Promise<boolean> {
    if (!this._redisCache) return false;
    if (detectCacheStoreKind(this._redisCache) !== 'redis') return false;
    try {
      const probeKey = `__infra:redis-probe:${process.pid}`;
      await this._redisCache.set(probeKey, 1, 3000);
      return (await this._redisCache.get(probeKey)) != null;
    } catch {
      return false;
    }
  }

  /** Tente de recréer le store Redis si absent ou mort. */
  async reconnectRedisEngineIfNeeded(): Promise<boolean> {
    if (await this.probeRedisEngine()) return true;

    this._redisCache = null;
    const defaultKind = detectCacheStoreKind(this._defaultCache);
    if (defaultKind === 'redis' && (await this._probeCache(this._defaultCache))) {
      this._redisCache = this._defaultCache;
      this._logger.log('Module cache layer: reusing global Redis store (recovery)');
      return true;
    }

    const redisOpts = readRedisCacheStoreOptionsFromConfig(this._config);
    if (!redisOpts) return false;
    try {
      const { redisStore } = await import('cache-manager-redis-yet');
      this._redisCache = await caching(redisStore, {
        ...redisOpts,
        ttl: 0,
      });
      this._logger.log('Module cache layer: Redis store reconnected');
      return await this.probeRedisEngine();
    } catch (err) {
      this._logger.warn(
        `Module cache layer: Redis reconnect failed (${(err as Error).message})`,
      );
      return false;
    }
  }

  private async _probeCache(cache: Cache): Promise<boolean> {
    try {
      const probeKey = `__infra:cache-probe:${process.pid}`;
      await cache.set(probeKey, 1, 3000);
      return (await cache.get(probeKey)) != null;
    } catch {
      return false;
    }
  }

  /** Sonde + reconnexion ; retourne true si Redis est opérationnel. */
  async refreshRedisEngineState(): Promise<boolean> {
    const wasUp = this._lastRedisEngineUp;
    await this.reconnectRedisEngineIfNeeded();
    const up = await this.probeRedisEngine();
    if (up && !wasUp) {
      this._redisRecoveryPending = true;
      this._logger.log('Module cache layer: Redis engine recovered');
    } else if (!up && wasUp) {
      this._logger.warn('Module cache layer: Redis engine lost');
      clearInflightCache();
    }
    this._lastRedisEngineUp = up;
    return up;
  }

  /** true une seule fois après une reprise Redis (down → up). */
  consumeRedisRecoveryEdge(): boolean {
    if (!this._redisRecoveryPending) return false;
    this._redisRecoveryPending = false;
    return true;
  }

  isRedisEngineUp(): boolean {
    return this._lastRedisEngineUp;
  }

  async bustPublicCatalogCaches(): Promise<{ keysCleared: number }> {
    let keysCleared = 0;
    for (const cache of this.allStores()) {
      const r = await bustPublicCatalogAppCaches(cache);
      keysCleared += Math.max(0, r.keysCleared);
    }
    return { keysCleared };
  }

  private async _bootstrapStores(): Promise<void> {
    const max = Number(this._config.get<string>('CACHE_MAX_ITEMS')) || 500;

    this._memoryCache = await caching('memory', { max, ttl: 0 });
    this._logger.log('Module cache layer: memory store ready');

    const defaultKind = detectCacheStoreKind(this._defaultCache);
    if (defaultKind === 'redis') {
      this._redisCache = this._defaultCache;
      this._logger.log('Module cache layer: reusing global Redis store');
    } else {
      const redisOpts = readRedisCacheStoreOptionsFromConfig(this._config);
      if (redisOpts) {
        try {
          const { redisStore } = await import('cache-manager-redis-yet');
          this._redisCache = await caching(redisStore, {
            ...redisOpts,
            ttl: 0,
          });
          this._logger.log('Module cache layer: dedicated Redis store ready');
        } catch (err) {
          this._logger.warn(
            `Module cache layer: Redis unavailable (${(err as Error).message})`,
          );
        }
      }
    }

    const memcachedConn = readMemcachedConnectionFromConfig(this._config);
    if (memcachedConn) {
      try {
        this._memcachedCache = await caching(
          () => createMemcachedStore({ connection: memcachedConn }),
          { ttl: 0 },
        );
        this._logger.log(
          `Module cache layer: Memcached store ready (${memcachedConn.servers}${memcachedConn.tls ? ' TLS' : ''})`,
        );
      } catch (err) {
        this._logger.warn(
          `Module cache layer: Memcached unavailable (${(err as Error).message})`,
        );
      }
    }
  }

  applyModuleEngines(partial: Partial<ModuleEngineMap>): void {
    for (const [key, engine] of Object.entries(partial) as Array<
      [AppCacheModuleKey, CacheEngine | undefined]
    >) {
      if (engine) {
        this._moduleEngines[key] = engine;
      }
    }
  }

  getModuleEngines(): ModuleEngineMap {
    return { ...this._moduleEngines };
  }

  getEffectiveModuleEngines(): ModuleEngineMap {
    const out = { ...this._moduleEngines };
    for (const key of Object.keys(out) as AppCacheModuleKey[]) {
      out[key] = this.resolveEngine(out[key]);
    }
    return out;
  }

  getAvailability(): CacheEngineAvailability {
    return {
      redis: this._redisCache != null,
      memcached: this._memcachedCache != null,
      memory: true,
    };
  }

  resolveEngine(requested: CacheEngine): CacheEngine {
    const chain: CacheEngine[] = [requested];
    if (requested !== 'redis') chain.push('redis');
    if (requested !== 'memcached') chain.push('memcached');
    chain.push('memory');
    for (const engine of chain) {
      if (this.isEngineAvailable(engine)) return engine;
    }
    return 'memory';
  }

  isEngineAvailable(engine: CacheEngine): boolean {
    if (engine === 'memory') return this._memoryCache != null;
    if (engine === 'redis') return this._redisCache != null;
    if (engine === 'memcached') return this._memcachedCache != null;
    return false;
  }

  cacheFor(module: AppCacheModuleKey): Cache {
    const engine = this.resolveEngine(this._moduleEngines[module]);
    return this.cacheForEngine(engine);
  }

  cacheForEngine(engine: CacheEngine): Cache {
    if (engine === 'redis' && this._redisCache) return this._redisCache;
    if (engine === 'memcached' && this._memcachedCache) {
      return this._memcachedCache;
    }
    if (this._memoryCache) return this._memoryCache;
    return this._defaultCache;
  }

  /** Store par défaut (compatibilité : ads targeting, etc.). */
  defaultCache(): Cache {
    return this._defaultCache;
  }

  allStores(): Cache[] {
    return dedupeCaches([
      this._defaultCache,
      this._memoryCache,
      this._redisCache,
      this._memcachedCache,
    ].filter(Boolean) as Cache[]);
  }

  async getOrSet<T>(
    module: AppCacheModuleKey,
    key: string,
    ttlMs: number,
    factory: () => Promise<T>,
  ): Promise<T> {
    return getOrSetCache(this.cacheFor(module), key, ttlMs, factory);
  }

  async bustKeyOnAllStores(key: string): Promise<void> {
    for (const cache of this.allStores()) {
      await bustCacheKey(cache, key);
    }
  }

  async bustPrefixOnAllStores(prefix: string): Promise<void> {
    for (const cache of this.allStores()) {
      await bustCacheKeysByPrefix(cache, prefix);
    }
  }

  async bustCatalogListing(storeId?: string): Promise<void> {
    for (const cache of this.allStores()) {
      await bustCatalogListingPublicCaches(cache, storeId);
    }
  }

  async bustProductDetail(productId: string): Promise<void> {
    for (const cache of this.allStores()) {
      await bustProductDetailCachesForProduct(cache, productId);
    }
  }

  async bustCartPricingForUser(userId: string): Promise<number> {
    let total = 0;
    for (const cache of this.allStores()) {
      total += await bustCartPricingCachesForUser(cache, userId);
    }
    return total;
  }

  async bustRecommendationFeedsForUser(userScope: string): Promise<number> {
    let total = 0;
    for (const cache of this.allStores()) {
      total += await bustRecommendationFeedCachesForUser(cache, userScope);
    }
    return total;
  }

  async bustAllRecommendationFeeds(): Promise<number> {
    let total = 0;
    for (const cache of this.allStores()) {
      total += await bustAllRecommendationFeedCaches(cache);
    }
    return total;
  }
}
