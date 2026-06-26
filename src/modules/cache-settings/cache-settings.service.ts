import {
  ForbiddenException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ModuleCacheLayerService } from '@common/cache/module-cache-layer.service';
import type { ModuleEngineMap } from '@common/cache/cache-engine.types';
import {
  apiPublicCacheTtlMs,
  bustAllPublicAppCaches,
  bustEntireAppCaches,
  bustPublicCatalogAppCaches,
  favoritesCacheTtlMs,
  fieldProjectionCacheTtlMs,
  productCategoriesCacheTtlMs,
  setRuntimeCacheTtlOverrides,
} from '@common/redis-app-cache';
import { setFieldProjectionCacheEnabled } from '@common/field-selection/field-projection-cache.interceptor';
import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  CacheSettingsDocument,
  CacheSettingsModel,
} from '@schemas/cache-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import {
  moduleEnginesFromDoc,
  UpdateCacheSettingsDto,
} from './dto/update-cache-settings.dto';

const SETTINGS_KEY = 'default';

export type CacheSettingsResponse = {
  publicCatalogTtlMs: number;
  favoritesTtlMs: number;
  productCategoriesTtlMs: number;
  fieldProjectionTtlMs: number;
  fieldProjectionEnabled: boolean;
  effectivePublicCatalogTtlMs: number;
  effectiveFavoritesTtlMs: number;
  effectiveProductCategoriesTtlMs: number;
  effectiveFieldProjectionTtlMs: number;
  envPublicCatalogTtlMs: number;
  envFavoritesTtlMs: number;
  envProductCategoriesTtlMs: number;
  envFieldProjectionTtlMs: number;
  moduleEngines: ModuleEngineMap;
  effectiveModuleEngines: ModuleEngineMap;
  enginesAvailable: {
    redis: boolean;
    memcached: boolean;
    memory: true;
  };
  /** @deprecated Utiliser effectiveModuleEngines */
  cacheStore: 'redis' | 'memcached' | 'memory';
  updatedAt: string | null;
};

export type ClearCacheResponse = {
  scope: 'public-catalog' | 'all' | 'everything';
  keysCleared: number;
  cacheStore: 'redis' | 'memcached' | 'memory';
  clearedAt: string;
};

@Injectable()
export class CacheSettingsService implements OnModuleInit {
  constructor(
    @InjectModel(CacheSettingsModel.name)
    private readonly _settings: Model<CacheSettingsDocument>,
    private readonly _cacheLayer: ModuleCacheLayerService,
    private readonly _storeAccess: StoreAccessService,
  ) {}

  async onModuleInit(): Promise<void> {
    const doc = await this.ensureSettingsDoc();
    this.applyRuntimeSettings(doc);
  }

  private async assertAdminSettings(user: UserModel): Promise<void> {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    await this._storeAccess.assertAdminPermission(user, 'admin.settings');
  }

  private envTtl(key: string, fallback: number): number {
    const n = Number(process.env[key]);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
  }

  private applyRuntimeSettings(doc: CacheSettingsModel): void {
    setRuntimeCacheTtlOverrides({
      publicCatalogTtlMs: doc.publicCatalogTtlMs,
      favoritesTtlMs: doc.favoritesTtlMs,
      productCategoriesTtlMs: doc.productCategoriesTtlMs,
      fieldProjectionTtlMs: doc.fieldProjectionTtlMs,
    });
    setFieldProjectionCacheEnabled(doc.fieldProjectionEnabled !== false);
    this._cacheLayer.applyModuleEngines(moduleEnginesFromDoc(doc));
  }

  private primaryStoreLabel(): 'redis' | 'memcached' | 'memory' {
    const effective = this._cacheLayer.getEffectiveModuleEngines();
    return effective.publicCatalog;
  }

  private toResponse(doc: CacheSettingsModel): CacheSettingsResponse {
    const typed = doc as unknown as { updatedAt?: Date };
    const moduleEngines = moduleEnginesFromDoc(doc);
    return {
      publicCatalogTtlMs: doc.publicCatalogTtlMs,
      favoritesTtlMs: doc.favoritesTtlMs,
      productCategoriesTtlMs: doc.productCategoriesTtlMs,
      fieldProjectionTtlMs: doc.fieldProjectionTtlMs ?? 120_000,
      fieldProjectionEnabled: doc.fieldProjectionEnabled !== false,
      effectivePublicCatalogTtlMs: apiPublicCacheTtlMs(),
      effectiveFavoritesTtlMs: favoritesCacheTtlMs(),
      effectiveProductCategoriesTtlMs: productCategoriesCacheTtlMs(),
      effectiveFieldProjectionTtlMs: fieldProjectionCacheTtlMs(),
      envPublicCatalogTtlMs: this.envTtl('API_PUBLIC_CACHE_TTL_MS', 90_000),
      envFavoritesTtlMs: this.envTtl('FAVORITES_CACHE_TTL_MS', 25_000),
      envProductCategoriesTtlMs: this.envTtl(
        'PRODUCT_CATEGORIES_CACHE_TTL_MS',
        120_000,
      ),
      envFieldProjectionTtlMs: this.envTtl(
        'FIELD_PROJECTION_CACHE_TTL_MS',
        120_000,
      ),
      moduleEngines,
      effectiveModuleEngines: this._cacheLayer.getEffectiveModuleEngines(),
      enginesAvailable: this._cacheLayer.getAvailability(),
      cacheStore: this.primaryStoreLabel(),
      updatedAt: typed.updatedAt?.toISOString?.() ?? null,
    };
  }

  private async ensureSettingsDoc(): Promise<CacheSettingsModel> {
    return this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $setOnInsert: {
            key: SETTINGS_KEY,
            publicCatalogTtlMs: this.envTtl('API_PUBLIC_CACHE_TTL_MS', 90_000),
            favoritesTtlMs: this.envTtl('FAVORITES_CACHE_TTL_MS', 25_000),
            productCategoriesTtlMs: this.envTtl(
              'PRODUCT_CATEGORIES_CACHE_TTL_MS',
              120_000,
            ),
            fieldProjectionTtlMs: this.envTtl(
              'FIELD_PROJECTION_CACHE_TTL_MS',
              120_000,
            ),
            fieldProjectionEnabled: true,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  async getSettings(user: UserModel): Promise<CacheSettingsResponse> {
    await this.assertAdminSettings(user);
    const doc = await this.ensureSettingsDoc();
    return this.toResponse(doc);
  }

  async updateSettings(
    user: UserModel,
    dto: UpdateCacheSettingsDto,
  ): Promise<CacheSettingsResponse> {
    await this.assertAdminSettings(user);
    const $set: Record<string, unknown> = {
      publicCatalogTtlMs: dto.publicCatalogTtlMs,
      favoritesTtlMs: dto.favoritesTtlMs,
      productCategoriesTtlMs: dto.productCategoriesTtlMs,
      fieldProjectionTtlMs: dto.fieldProjectionTtlMs,
    };
    if (dto.fieldProjectionEnabled !== undefined) {
      $set.fieldProjectionEnabled = dto.fieldProjectionEnabled;
    }
    if (dto.moduleEngines) {
      $set.moduleEngines = dto.moduleEngines;
    }
    const updated = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $set,
          $setOnInsert: { key: SETTINGS_KEY },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    this.applyRuntimeSettings(updated);
    return this.toResponse(updated);
  }

  async clearCache(
    user: UserModel,
    scope: 'public-catalog' | 'all' | 'everything',
  ): Promise<ClearCacheResponse> {
    await this.assertAdminSettings(user);
    const stores = this._cacheLayer.allStores();
    let keysCleared = 0;
    for (const store of stores) {
      const result =
        scope === 'everything'
          ? await bustEntireAppCaches(store)
          : scope === 'all'
            ? await bustAllPublicAppCaches(store)
            : await bustPublicCatalogAppCaches(store);
      if (result.keysCleared >= 0) {
        keysCleared += result.keysCleared;
      } else {
        keysCleared = -1;
      }
    }
    return {
      scope,
      keysCleared,
      cacheStore: this.primaryStoreLabel(),
      clearedAt: new Date().toISOString(),
    };
  }
}
