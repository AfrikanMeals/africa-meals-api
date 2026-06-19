import {
  ForbiddenException,
  Inject,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { InjectModel } from '@nestjs/mongoose';
import {
  apiPublicCacheTtlMs,
  bustAllPublicAppCaches,
  bustPublicCatalogAppCaches,
  detectCacheStoreKind,
  favoritesCacheTtlMs,
  productCategoriesCacheTtlMs,
  setRuntimeCacheTtlOverrides,
} from '@common/redis-app-cache';
import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  CacheSettingsDocument,
  CacheSettingsModel,
} from '@schemas/cache-settings.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Cache } from 'cache-manager';
import { Model } from 'mongoose';
import { UpdateCacheSettingsDto } from './dto/update-cache-settings.dto';

const SETTINGS_KEY = 'default';

export type CacheSettingsResponse = {
  publicCatalogTtlMs: number;
  favoritesTtlMs: number;
  productCategoriesTtlMs: number;
  effectivePublicCatalogTtlMs: number;
  effectiveFavoritesTtlMs: number;
  effectiveProductCategoriesTtlMs: number;
  envPublicCatalogTtlMs: number;
  envFavoritesTtlMs: number;
  envProductCategoriesTtlMs: number;
  cacheStore: 'redis' | 'memory';
  updatedAt: string | null;
};

export type ClearCacheResponse = {
  scope: 'public-catalog' | 'all';
  keysCleared: number;
  cacheStore: 'redis' | 'memory';
  clearedAt: string;
};

@Injectable()
export class CacheSettingsService implements OnModuleInit {
  constructor(
    @InjectModel(CacheSettingsModel.name)
    private readonly _settings: Model<CacheSettingsDocument>,
    @Inject(CACHE_MANAGER)
    private readonly _cache: Cache,
    @Inject(StoreAccessService)
    private readonly _storeAccess: StoreAccessService,
  ) {}

  async onModuleInit(): Promise<void> {
    const doc = await this.ensureSettingsDoc();
    this.applyRuntimeTtls(doc);
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

  private applyRuntimeTtls(doc: CacheSettingsModel): void {
    setRuntimeCacheTtlOverrides({
      publicCatalogTtlMs: doc.publicCatalogTtlMs,
      favoritesTtlMs: doc.favoritesTtlMs,
      productCategoriesTtlMs: doc.productCategoriesTtlMs,
    });
  }

  private toResponse(doc: CacheSettingsModel): CacheSettingsResponse {
    const typed = doc as unknown as { updatedAt?: Date };
    return {
      publicCatalogTtlMs: doc.publicCatalogTtlMs,
      favoritesTtlMs: doc.favoritesTtlMs,
      productCategoriesTtlMs: doc.productCategoriesTtlMs,
      effectivePublicCatalogTtlMs: apiPublicCacheTtlMs(),
      effectiveFavoritesTtlMs: favoritesCacheTtlMs(),
      effectiveProductCategoriesTtlMs: productCategoriesCacheTtlMs(),
      envPublicCatalogTtlMs: this.envTtl('API_PUBLIC_CACHE_TTL_MS', 90_000),
      envFavoritesTtlMs: this.envTtl('FAVORITES_CACHE_TTL_MS', 25_000),
      envProductCategoriesTtlMs: this.envTtl(
        'PRODUCT_CATEGORIES_CACHE_TTL_MS',
        120_000,
      ),
      cacheStore: detectCacheStoreKind(this._cache),
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
    const updated = await this._settings
      .findOneAndUpdate(
        { key: SETTINGS_KEY },
        {
          $set: {
            publicCatalogTtlMs: dto.publicCatalogTtlMs,
            favoritesTtlMs: dto.favoritesTtlMs,
            productCategoriesTtlMs: dto.productCategoriesTtlMs,
          },
          $setOnInsert: { key: SETTINGS_KEY },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    this.applyRuntimeTtls(updated);
    return this.toResponse(updated);
  }

  async clearCache(
    user: UserModel,
    scope: 'public-catalog' | 'all',
  ): Promise<ClearCacheResponse> {
    await this.assertAdminSettings(user);
    const result =
      scope === 'all'
        ? await bustAllPublicAppCaches(this._cache)
        : await bustPublicCatalogAppCaches(this._cache);
    return {
      scope,
      keysCleared: result.keysCleared,
      cacheStore: detectCacheStoreKind(this._cache),
      clearedAt: new Date().toISOString(),
    };
  }
}
