import { ModuleCacheLayerService } from '@common/cache/module-cache-layer.service';
import {
  bumpCacheBustGeneration,
  clearInflightCache,
} from '@common/redis-app-cache';
import { BullmqRedisConnectionsService } from '@common/redis/bullmq-redis-connections.service';
import { SharedRedisService } from '@common/redis/shared-redis.service';
import { DomainEventPublisherService } from '@common/domain-events/domain-event-publisher.service';
import { ShopHomeService } from '@modules/shop-home/shop-home.service';
import { WsNotifyDispatchQueueService } from '@modules/ws-notify/ws-notify-dispatch-queue.service';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';

type RecoveryHandler = () => Promise<void>;

/**
 * Surveille Redis / MQTT après migration ou coupure, purge les caches stale
 * et relance les tâches de fond (warm accueil, files BullMQ, clients MQTT).
 */
@Injectable()
export class InfraRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly _logger = new Logger(InfraRecoveryService.name);
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _mqttWasUp = false;
  private _handlers: RecoveryHandler[] = [];

  constructor(
    private readonly _config: ConfigService,
    private readonly _moduleRef: ModuleRef,
    private readonly _cacheLayer: ModuleCacheLayerService,
    private readonly _sharedRedis: SharedRedisService,
    private readonly _bullRedis: BullmqRedisConnectionsService,
    @Optional() private readonly _shopHome?: ShopHomeService,
  ) {}

  onModuleInit(): void {
    const intervalMs = Number(
      this._config.get<string>('INFRA_RECOVERY_PROBE_MS') ?? 20_000,
    );
    if (!Number.isFinite(intervalMs) || intervalMs < 5_000) {
      return;
    }
    void this._probeAndRecover();
    this._timer = setInterval(() => void this._probeAndRecover(), intervalMs);
  }

  onModuleDestroy(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  registerRecoveryHandler(handler: RecoveryHandler): void {
    this._handlers.push(handler);
  }

  private async _probeAndRecover(): Promise<void> {
    try {
      await this._sharedRedis.ensureConnected();
      await this._bullRedis.ensureConnected();
      await this._cacheLayer.refreshRedisEngineState();

      if (this._cacheLayer.consumeRedisRecoveryEdge()) {
        await this._onRedisRecovered();
      }

      const mqttUp = this._readMqttUp();
      if (mqttUp && !this._mqttWasUp) {
        await this._onMqttRecovered();
      }
      this._mqttWasUp = mqttUp;
    } catch (err) {
      this._logger.warn(
        `Infra recovery probe failed: ${(err as Error).message}`,
      );
    }
  }

  private async _onRedisRecovered(): Promise<void> {
    this._logger.warn(
      'Redis recovered — busting stale catalog caches and warming shop home',
    );
    clearInflightCache();
    await bumpCacheBustGeneration();
    try {
      const r = await this._cacheLayer.bustPublicCatalogCaches();
      this._logger.log(
        `Public catalog cache bust after Redis recovery (keys≈${r.keysCleared})`,
      );
    } catch (err) {
      this._logger.warn(
        `Catalog cache bust failed: ${(err as Error).message}`,
      );
    }
    try {
      await this._shopHome?.bustAllShopHomeCaches();
    } catch (_) {
      /* best-effort */
    }
    try {
      await this._shopHome?.warmAnonymousCache(
        Number(process.env.SHOP_HOME_WARM_PRODUCTS_TAKE) || 48,
      );
    } catch (err) {
      this._logger.warn(`Shop home warm failed: ${(err as Error).message}`);
    }
    for (const handler of this._handlers) {
      try {
        await handler();
      } catch (err) {
        this._logger.warn(
          `Recovery handler failed: ${(err as Error).message}`,
        );
      }
    }
    try {
      const domain = this._moduleRef.get(DomainEventPublisherService, {
        strict: false,
      });
      await domain?.recoverAfterInfraOutage?.();
    } catch (_) {
      /* optional */
    }
  }

  private async _onMqttRecovered(): Promise<void> {
    this._logger.warn('MQTT broker recovered — reinitializing clients');
    try {
      const domain = this._moduleRef.get(DomainEventPublisherService, {
        strict: false,
      });
      domain?.recoverMqttAfterOutage?.();
    } catch (_) {
      /* optional provider */
    }
    try {
      const ws = this._moduleRef.get(WsNotifyDispatchQueueService, {
        strict: false,
      });
      ws?.recoverMqttAfterOutage?.();
    } catch (_) {
      /* optional provider */
    }
  }

  private _readMqttUp(): boolean {
    try {
      const ws = this._moduleRef.get(WsNotifyDispatchQueueService, {
        strict: false,
      });
      if (ws?.isMqttConnected?.()) return true;
    } catch (_) {
      /* ignore */
    }
    try {
      const domain = this._moduleRef.get(DomainEventPublisherService, {
        strict: false,
      });
      if (domain?.isMqttConnected?.()) return true;
    } catch (_) {
      /* ignore */
    }
    return false;
  }
}
