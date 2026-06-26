import { AdsService } from '@modules/ads/ads.service';
import { AnnouncementsService } from '@modules/announcements/announcements.service';
import { ProductCategoryService } from '@modules/products/product-category.service';
import { SearchService } from '@modules/search/search.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import { safeCacheGet, safeCacheSet } from '@common/redis-app-cache';
import { ModuleCacheLayerService } from '@common/cache/module-cache-layer.service';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { UserModel } from '@schemas/user.schema';
import {
  slimAdForPublicClient,
  slimAnnouncementForClient,
  slimProductCategoryForPublicClient,
} from '@utils/public-client-shapes';

export type ShopHomePayload = {
  announcements: Record<string, unknown>[];
  ads: Record<string, unknown>[];
  categories: Record<string, unknown>[];
  products: Record<string, unknown>[];
};

@Injectable()
export class ShopHomeService {
  private readonly _logger = new Logger(ShopHomeService.name);

  @Inject(ModuleCacheLayerService)
  private readonly _cacheLayer: ModuleCacheLayerService;

  @Inject(AnnouncementsService)
  private readonly _announcements: AnnouncementsService;

  @Inject(AdsService)
  private readonly _ads: AdsService;

  @Inject(ProductCategoryService)
  private readonly _categories: ProductCategoryService;

  @Inject(SearchService)
  private readonly _search: SearchService;

  @Inject(SupportedCountriesService)
  private readonly _supportedCountries: SupportedCountriesService;

  private cacheKey(user?: UserModel, clientRegion?: string) {
    const id =
      (
        user as unknown as { _id?: { toString?: () => string } }
      )?._id?.toString?.() ?? '';
    const region = String(clientRegion ?? 'CA')
      .trim()
      .toUpperCase();
    return `shophome:v4-region:${/^[A-Z]{2}$/.test(region) ? region : 'CA'}:${id || 'anon'}`;
  }

  private ttlMs() {
    const n = Number(process.env.SHOP_HOME_CACHE_TTL_MS);
    return Number.isFinite(n) && n > 0 ? n : 90_000;
  }

  /** Évite `JSON.parse(JSON.stringify)` sur les documents Mongoose (coûteux). */
  private _docsToPlainJson(docs: unknown[]): Record<string, unknown>[] {
    return docs.map((d) => {
      const toJson = (d as { toJSON?: () => Record<string, unknown> })?.toJSON;
      if (typeof toJson === 'function') {
        return toJson.call(d);
      }
      return JSON.parse(JSON.stringify(d)) as Record<string, unknown>;
    });
  }

  /** Cache hit vide alors que des catégories annoncent du contenu → recompute (Redis migré / TTL stale). */
  private _isStaleEmptyShopHomeHit(hit: ShopHomePayload): boolean {
    if (!Array.isArray(hit.products) || hit.products.length > 0) {
      return false;
    }
    return (hit.categories ?? []).some(
      (row) => Number((row as { productCount?: number }).productCount ?? 0) > 0,
    );
  }

  /**
   * Bundle accueil : annonces + pubs + catégories + produits (léger).
   * Mis en cache par utilisateur (anon vs vendeur connecté).
   */
  async load(
    user?: UserModel,
    productsTake = 48,
    countryCode?: string,
  ): Promise<ShopHomePayload> {
    const clientRegion =
      await this._supportedCountries.resolveClientCatalogRegion(
        user,
        countryCode,
      );
    const key = this.cacheKey(user, clientRegion);
    const cache = this._cacheLayer.cacheFor('publicCatalog');
    const hit = await safeCacheGet<ShopHomePayload>(cache, key);

    const take = Math.min(120, Math.max(8, Math.floor(productsTake)));

    const mapAds = (adDocs: unknown[]) =>
      this._docsToPlainJson(adDocs).map((row) => slimAdForPublicClient(row));

    if (hit != null && !this._isStaleEmptyShopHomeHit(hit)) {
      const adDocs = await this._ads.listPublic(clientRegion);
      return { ...hit, ads: mapAds(adDocs) };
    }

    const [announcementDocs, adDocs, categories, products] = await Promise.all([
      this._announcements.list(),
      this._ads.listPublic(clientRegion),
      this._categories.filter(),
      this._search.homeFeedProducts(user, take, clientRegion),
    ]);

    const announcements = this._docsToPlainJson(announcementDocs).map((row) =>
      slimAnnouncementForClient(row),
    );
    const ads = mapAds(adDocs);
    const categoriesSlim = (categories as Record<string, unknown>[]).map(
      (row) => slimProductCategoryForPublicClient(row),
    );

    const payload: ShopHomePayload = {
      announcements,
      ads,
      categories: categoriesSlim,
      products,
    };

    await safeCacheSet(cache, key, payload, this.ttlMs());
    return payload;
  }

  /** Invalide le cache accueil (toutes régions / utilisateurs) après reprise Redis. */
  async bustAllShopHomeCaches(): Promise<void> {
    await this._cacheLayer.bustPrefixOnAllStores('shophome:v3-region:');
    await this._cacheLayer.bustPrefixOnAllStores('shophome:v4-region:');
  }

  /** Préchauffage cache (cron / tâche planifiée), utile après expiration TTL. */
  async warmAnonymousCache(productsTake = 48): Promise<void> {
    try {
      await this.load(undefined, productsTake);
    } catch (e) {
      this._logger.warn(`warmAnonymousCache failed: ${(e as Error).message}`);
    }
  }
}
