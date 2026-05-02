import { AdsService } from '@modules/ads/ads.service';
import { AnnouncementsService } from '@modules/announcements/announcements.service';
import { ProductCategoryService } from '@modules/products/product-category.service';
import { SearchService } from '@modules/search/search.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { UserModel } from '@schemas/user.schema';
import { Cache } from 'cache-manager';
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

  @Inject(CACHE_MANAGER)
  private readonly _cache: Cache;

  @Inject(AnnouncementsService)
  private readonly _announcements: AnnouncementsService;

  @Inject(AdsService)
  private readonly _ads: AdsService;

  @Inject(ProductCategoryService)
  private readonly _categories: ProductCategoryService;

  @Inject(SearchService)
  private readonly _search: SearchService;

  private cacheKey(user?: UserModel) {
    const id =
      (user as unknown as { _id?: { toString?: () => string } })?._id?.toString?.() ??
      '';
    return `shophome:${id || 'anon'}`;
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

  /**
   * Bundle accueil : annonces + pubs + catégories + produits (léger).
   * Mis en cache par utilisateur (anon vs vendeur connecté).
   */
  async load(user?: UserModel, productsTake = 48): Promise<ShopHomePayload> {
    const key = this.cacheKey(user);
    const hit = await this._cache.get<ShopHomePayload>(key);
    if (hit != null) {
      return hit;
    }

    const take = Math.min(120, Math.max(8, Math.floor(productsTake)));

    const [announcementDocs, adDocs, categories, products] = await Promise.all([
      this._announcements.list(),
      this._ads.list(),
      this._categories.filter(),
      this._search.homeFeedProducts(user, take),
    ]);

    const announcements = this._docsToPlainJson(announcementDocs).map((row) =>
      slimAnnouncementForClient(row),
    );
    const ads = this._docsToPlainJson(adDocs).map((row) =>
      slimAdForPublicClient(row),
    );
    const categoriesSlim = (categories as Record<string, unknown>[]).map(
      (row) => slimProductCategoryForPublicClient(row),
    );

    const payload: ShopHomePayload = {
      announcements,
      ads,
      categories: categoriesSlim,
      products,
    };

    await this._cache.set(key, payload, this.ttlMs());
    return payload;
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
