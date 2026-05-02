import { SearchService } from '@modules/search/search.service';
import {
  SearchContent,
  SearchDto,
  SortBy,
  SortOrder,
} from '@modules/search/dto/search.dto';
import { StoreService } from '@modules/store/store.service';
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
  ): Promise<StoreMenuBundlePayload> {
    const take = Math.min(120, Math.max(8, Math.floor(productsTake)));
    const page = Math.max(1, Math.floor(productsPage));
    const dto: SearchDto = {
      searchContent: [SearchContent.PRODUCTS],
      query: '',
      storeId,
      page,
      take,
      sortBy: SortBy.CREATED_AT,
      sortDirection: SortOrder.DESC,
    };
    const [meta, searchOut] = await Promise.all([
      this._stores.findPublicStoreMenuMeta(storeId),
      this._search.filter(dto, user),
    ]);
    const pr = searchOut.products;
    const items = pr?.items ?? [];
    const products = items.map((p) => this._productToPlain(p));
    const productsTotal =
      typeof pr?.total === 'number' && Number.isFinite(pr.total)
        ? pr.total
        : products.length;
    return { store: meta, products, productsTotal };
  }
}
