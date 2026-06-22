import { SearchService } from '@modules/search/search.service';
import { StoreService } from '@modules/store/store.service';
import { normalizeCountryCode } from '@modules/supported-countries/client-market-region.util';
import {
  AppCacheKeys,
  apiPublicCacheTtlMs,
  cacheUserScope,
} from '@common/redis-app-cache';
import { ModuleCacheLayerService } from '@common/cache/module-cache-layer.service';
import { Inject, Injectable } from '@nestjs/common';
import { UserModel } from '@schemas/user.schema';

export type StoreMenuBundlePayload = {
  store: Record<string, unknown> | null;
  products: Record<string, unknown>[];
  /** Total produits correspondant au filtre boutique (pagination). */
  productsTotal: number;
};

@Injectable()
export class StoreMenuBundleService {
  @Inject(ModuleCacheLayerService)
  private readonly _cacheLayer: ModuleCacheLayerService;

  @Inject(StoreService)
  private readonly _stores: StoreService;

  @Inject(SearchService)
  private readonly _search: SearchService;

  private _productToPlain(p: unknown): Record<string, unknown> {
    const toJson = (p as { toJSON?: () => Record<string, unknown> })?.toJSON;
    if (typeof toJson === 'function') {
      return toJson.call(p);
    }
    return JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
  }

  /**
   * Méta boutique légère + liste produits (même filtre métier que `GET /search` avec `storeId`).
   */
  async load(
    storeId: string,
    productsTake: number,
    user?: UserModel,
    productsPage = 1,
    options?: {
      clientPlatform?: string;
      countryCode?: string;
    },
  ): Promise<StoreMenuBundlePayload> {
    const take = Math.min(120, Math.max(8, Math.floor(productsTake)));
    const page = Math.max(1, Math.floor(productsPage));
    const clientPlatform = options?.clientPlatform;
    const countryCode = normalizeCountryCode(options?.countryCode);
    const scope =
      cacheUserScope(user) +
      (countryCode ? `:cc${countryCode}` : '') +
      (clientPlatform === 'web' ? ':web-catalog' : ':client-catalog');
    const cacheKey = AppCacheKeys.storeMenuBundle(storeId, page, take, scope);
    const metaOptions = {
      clientPlatform,
      countryCode: countryCode || undefined,
      user,
    };
    return this._cacheLayer.getOrSet(
      'publicCatalog',
      cacheKey,
      apiPublicCacheTtlMs(),
      async () => {
        const [meta, pageOut] = await Promise.all([
          this._stores.findPublicStoreMenuMeta(storeId, metaOptions),
          this._search.storeMenuProductsLeanPage(
            storeId,
            page,
            take,
            user,
            undefined,
            clientPlatform,
            countryCode || undefined,
          ),
        ]);
        const products = pageOut.items.map((p) => this._productToPlain(p));
        return {
          store: meta,
          products,
          productsTotal: pageOut.total,
        };
      },
    );
  }
}
