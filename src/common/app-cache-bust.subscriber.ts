import {
  bustCacheKeysByPrefix,
  bumpCacheBustGenerationLocal,
  clearInflightCache,
  registerAppCacheBustClusterPublisher,
  registerAppCacheBustRedis,
  APP_CACHE_BUST_CHANNEL,
} from '@common/redis-app-cache';
import { ModuleCacheLayerService } from '@common/cache/module-cache-layer.service';
import { SharedRedisService } from '@common/redis/shared-redis.service';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type Redis from 'ioredis';

/** Propage les bust cache entre workers PM2 (cache mémoire par processus). */
@Injectable()
export class AppCacheBustSubscriber implements OnModuleInit {
  private readonly _logger = new Logger(AppCacheBustSubscriber.name);
  private subscriber: Redis | null = null;

  constructor(
    private readonly _cacheLayer: ModuleCacheLayerService,
    private readonly _sharedRedis: SharedRedisService,
  ) {}

  onModuleInit(): void {
    const client = this._sharedRedis.getClient();
    registerAppCacheBustRedis(client);

    if (!client) return;

    registerAppCacheBustClusterPublisher(async (payload) => {
      await client.publish(APP_CACHE_BUST_CHANNEL, payload);
    });

    this.subscriber = client.duplicate();
    this.subscriber.on('error', (err) => {
      const msg = err.message ?? '';
      if (msg.includes('ECONNRESET')) return;
      this._logger.warn(`Cache bust subscriber error: ${msg}`);
    });
    void this.subscriber
      .subscribe(APP_CACHE_BUST_CHANNEL)
      .then(() => {
        this._logger.log(`Subscribed to ${APP_CACHE_BUST_CHANNEL}`);
      })
      .catch((err: Error) => {
        this._logger.warn(`Cache bust subscribe failed: ${err.message}`);
      });

    this.subscriber.on('message', (channel, raw) => {
      if (channel !== APP_CACHE_BUST_CHANNEL) return;
      void this._onClusterBust(raw);
    });
  }

  private async _onClusterBust(raw: string): Promise<void> {
    try {
      const parsed = JSON.parse(raw) as { prefixes?: unknown };
      const prefixes = Array.isArray(parsed.prefixes)
        ? parsed.prefixes.map(String).filter(Boolean)
        : [];
      bumpCacheBustGenerationLocal();
      clearInflightCache();
      for (const cache of this._cacheLayer.allStores()) {
        for (const prefix of prefixes) {
          await bustCacheKeysByPrefix(cache, prefix, {
            skipClusterNotify: true,
          });
        }
      }
    } catch (err) {
      this._logger.warn(
        `Cluster cache bust ignored: ${(err as Error).message}`,
      );
    }
  }
}
