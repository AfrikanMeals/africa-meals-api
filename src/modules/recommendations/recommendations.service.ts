import { storeOwnerStripeOnboardedPipelineStages } from '@modules/billing/stripe/stripe-connect-visibility';
import { DrinksService } from '@modules/drinks/drinks.service';
import { SearchService } from '@modules/search/search.service';
import { StoreSubscribersService } from '@modules/store-subscribers/store-subscribers.service';
import { SearchSettingsService } from '@modules/search-settings/search-settings.service';
import { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';
import { BadRequestException, Injectable, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { ProductModel, ProductStatusEnum } from '@schemas/product.schema';
import { ProductRatingModel } from '@schemas/product_rating.schema';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import {
  UserRecommendationSignalKind,
  UserRecommendationSignalModel,
} from '@schemas/user-recommendation-signal.schema';
import {
  RecommendationTrainingSnapshotModel,
  RECOMMENDATION_GLOBAL_SNAPSHOT_KEY,
} from '@schemas/recommendation-training-snapshot.schema';
import { UserRecommendationDigestModel } from '@schemas/user-recommendation-digest.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import {
  normalizeRecommendationSearchTerm,
  searchTermToRefObjectId,
} from '@utils/recommendation-search.util';
import { storeArticlesAvailabilityPipelineStages } from '@utils/store-articles-availability.pipeline';
import { TrackRecommendationDto } from './dto/track-recommendation.dto';

const PAID_LIKE_STATUSES: OrderStatusEnum[] = [
  OrderStatusEnum.PAIED,
  OrderStatusEnum.APPROVED,
  OrderStatusEnum.SHIPPED,
  OrderStatusEnum.COMPLETED,
];

@Injectable()
export class RecommendationsService {
  @Inject(DrinksService)
  private readonly _drinksService: DrinksService;

  constructor(
    private readonly _search: SearchService,
    private readonly _subscriptions: SubscriptionsService,
    private readonly _storeSubscribers: StoreSubscribersService,
    private readonly _searchSettings: SearchSettingsService,
    @InjectModel(UserRecommendationSignalModel.name)
    private readonly _signalModel: Model<UserRecommendationSignalModel>,
    @InjectModel(OrderModel.name)
    private readonly _orderModel: Model<OrderModel>,
    @InjectModel(StoreModel.name)
    private readonly _storeModel: Model<StoreModel>,
    @InjectModel(ProductModel.name)
    private readonly _productModel: Model<ProductModel>,
    @InjectModel(ProductRatingModel.name)
    private readonly _ratingModel: Model<ProductRatingModel>,
    @InjectModel(RecommendationTrainingSnapshotModel.name)
    private readonly _trainingSnapshotModel: Model<RecommendationTrainingSnapshotModel>,
    @InjectModel(UserRecommendationDigestModel.name)
    private readonly _userDigestModel: Model<UserRecommendationDigestModel>,
  ) {}

  private _userOid(user?: UserModel): Types.ObjectId | null {
    if (!user) return null;
    const u = user as unknown as { _id?: Types.ObjectId | string; id?: string };
    const raw = u._id ?? u.id;
    if (raw == null || raw === '') return null;
    try {
      if (raw instanceof Types.ObjectId) return raw;
      const s = String(raw);
      if (!Types.ObjectId.isValid(s)) return null;
      return new Types.ObjectId(s);
    } catch {
      return null;
    }
  }

  async track(user: UserModel, dto: TrackRecommendationDto): Promise<void> {
    const userOid = this._userOid(user);
    if (!userOid) throw new BadRequestException('invalid_user');

    let refOid: Types.ObjectId;
    let searchStored: string | undefined;

    if (dto.kind === UserRecommendationSignalKind.SEARCH_QUERY) {
      const normalized = normalizeRecommendationSearchTerm(
        dto.searchTerm ?? '',
      );
      if (normalized.length < 2) {
        throw new BadRequestException('invalid_search_term');
      }
      refOid = searchTermToRefObjectId(normalized);
      searchStored = normalized;
    } else {
      if (!dto.refId || !Types.ObjectId.isValid(dto.refId)) {
        throw new BadRequestException('invalid_ref');
      }
      refOid = new Types.ObjectId(dto.refId);
    }

    const dedupeProductMs =
      Number(process.env.RECOMMENDATION_TRACK_DEDUPE_PRODUCT_MS) || 120_000;
    const dedupeStoreMs =
      Number(process.env.RECOMMENDATION_TRACK_DEDUPE_STORE_MS) || 180_000;
    const dedupeSearchMs =
      Number(process.env.RECOMMENDATION_TRACK_DEDUPE_SEARCH_MS) || 60_000;
    const windowMs =
      dto.kind === UserRecommendationSignalKind.STORE_VIEW
        ? dedupeStoreMs
        : dto.kind === UserRecommendationSignalKind.SEARCH_QUERY
        ? dedupeSearchMs
        : dedupeProductMs;
    const since = new Date(Date.now() - Math.max(5_000, windowMs));
    const recent = await this._signalModel
      .findOne({
        user: userOid,
        kind: dto.kind,
        refId: refOid,
        createdAt: { $gte: since },
      })
      .select('_id')
      .lean()
      .exec();
    if (recent) {
      return;
    }
    await this._signalModel.create({
      user: userOid,
      kind: dto.kind,
      refId: refOid,
      ...(searchStored != null ? { searchTerm: searchStored } : {}),
    });
  }

  /** Poids du scoring fil (admin + variables d’environnement). */
  private async _scoreWeights() {
    return this._searchSettings.getRecommendationWeights();
  }

  private _storeIdFromProduct(p: Record<string, unknown>): string {
    const st = p.store as Record<string, unknown> | undefined;
    return st ? String(st.id ?? st._id ?? '').trim() : '';
  }

  private _collectCandidateStoreIds(
    candidates: Record<string, unknown>[],
  ): string[] {
    const ids = new Set<string>();
    for (const p of candidates) {
      const sid = this._storeIdFromProduct(p);
      if (sid) ids.add(sid);
    }
    return [...ids];
  }

  async getFeed(
    user: UserModel | undefined,
    takeRaw?: string,
    /** Si fourni (ex. bundle `shopHome`), évite un second `homeFeedProducts` identique. */
    productCandidates?: Record<string, unknown>[],
  ): Promise<{
    products: Record<string, unknown>[];
    stores: Record<string, unknown>[];
    drinks: Record<string, unknown>[];
  }> {
    const take = Math.min(48, Math.max(4, parseInt(takeRaw ?? '24', 10) || 24));
    const poolLimit = Math.min(120, Math.max(take * 4, 60));

    const userOid = this._userOid(user);

    const [candidates, snapshot, digestDoc] = await Promise.all([
      productCandidates != null && productCandidates.length > 0
        ? Promise.resolve(productCandidates)
        : this._search.homeFeedProducts(user, poolLimit),
      this._trainingSnapshotModel
        .findOne({ docKey: RECOMMENDATION_GLOBAL_SNAPSHOT_KEY })
        .lean()
        .exec(),
      userOid
        ? this._userDigestModel.findOne({ user: userOid }).lean().exec()
        : Promise.resolve(null),
    ]);

    const W = await this._scoreWeights();
    const candidateStoreIds = this._collectCandidateStoreIds(candidates);
    const [planSortByStore, subscribedStoreIds] = await Promise.all([
      this._subscriptions.resolveActivePlanSortOrderByStoreIds(
        candidateStoreIds,
      ),
      user && userOid
        ? this._storeSubscribers.listSubscribedStoreIds(user)
        : Promise.resolve([]),
    ]);
    const subscribedStoreBoost = new Set(subscribedStoreIds);
    const trendProductBoost = new Map<string, number>();
    const trendIds = snapshot?.trendProductIds ?? [];
    for (let i = 0; i < trendIds.length; i++) {
      const id = String(trendIds[i] ?? '').trim();
      if (!id) continue;
      trendProductBoost.set(
        id,
        Math.max(0, W.trendProductMax - i * W.trendProductDecay),
      );
    }

    const digestProductBoost = new Set(
      (digestDoc?.topViewedProductIds ?? []).map((x) => String(x)),
    );
    const digestStoreBoost = new Set(
      (digestDoc?.topViewedStoreIds ?? []).map((x) => String(x)),
    );

    const digestSearchTerms =
      ((digestDoc as Record<string, unknown> | null)?.['topSearchTerms'] as
        | string[]
        | undefined) ?? [];
    const globalSearchTerms =
      ((snapshot as Record<string, unknown> | null)?.['trendSearchQueries'] as
        | string[]
        | undefined) ?? [];

    const searchBoostFor = (
      title: string,
      bio: string,
      terms: string[],
      weight: number,
    ): number => {
      if (!terms.length || weight <= 0) return 0;
      const hay = `${title} ${bio}`.toLowerCase();
      for (const t of terms) {
        const s = (t ?? '').trim().toLowerCase();
        if (s.length >= 2 && hay.includes(s)) {
          return weight;
        }
      }
      return 0;
    };

    const favProductIds = new Set<string>();
    const favStoreIds = new Set<string>();
    const viewedProductIds = new Set<string>();
    const viewedStoreIds = new Set<string>();
    const favCategoryIds = new Set<string>();
    const reviewedProductIds = new Set<string>();

    if (userOid) {
      const [favP, favS, signals, ratedIds] = await Promise.all([
        this._productModel
          .find({
            likedBy: userOid,
            status: ProductStatusEnum.ACTIVE,
          })
          .select('_id category')
          .limit(200)
          .lean()
          .exec(),
        this._storeModel
          .distinct('_id', {
            likedBy: userOid,
            status: StoreStatusEnum.ACTIVE,
          })
          .exec(),
        this._signalModel
          .find({ user: userOid })
          .sort({ createdAt: -1 })
          .limit(100)
          .lean()
          .exec(),
        this._ratingModel.distinct('product', { user: userOid }).exec(),
      ]);

      for (const row of favP) {
        const r = row as unknown as {
          _id?: Types.ObjectId;
          category?: Types.ObjectId;
        };
        const id = r._id?.toString();
        if (id) favProductIds.add(id);
        const cat = r.category;
        if (cat) favCategoryIds.add(cat.toString());
      }
      for (const sid of favS) {
        favStoreIds.add(String(sid));
      }
      for (const s of signals) {
        const ref = (s as { refId?: Types.ObjectId }).refId;
        if (!ref) continue;
        const id = ref.toString();
        if (s.kind === UserRecommendationSignalKind.PRODUCT_VIEW) {
          viewedProductIds.add(id);
        } else if (s.kind === UserRecommendationSignalKind.STORE_VIEW) {
          viewedStoreIds.add(id);
        }
      }
      for (const pid of ratedIds) {
        if (pid) reviewedProductIds.add(String(pid));
      }
    }

    const scoreOne = (p: Record<string, unknown>): number => {
      const id = String(p.id ?? p._id ?? '');
      const storeId = this._storeIdFromProduct(p);
      const cat = p.category as Record<string, unknown> | undefined;
      const catId = cat ? String(cat.id ?? cat._id ?? '') : '';

      const likes = Number(p.likesCount ?? 0);
      const rating = Number(p.averageRating ?? 0);
      let score = likes * W.perLike + rating * W.perRating;
      const created = Date.parse(String(p.createdAt ?? ''));
      if (!Number.isNaN(created)) {
        score += created / (86400000 * W.recencyDivisor);
      }

      if (favProductIds.has(id)) score += W.favProduct;
      if (storeId && favStoreIds.has(storeId)) score += W.favStore;
      if (storeId && viewedStoreIds.has(storeId)) score += W.viewedStore;
      if (viewedProductIds.has(id)) score += W.viewedProduct;
      if (catId && favCategoryIds.has(catId)) score += W.favCategory;
      if (reviewedProductIds.has(id)) score += W.ratedProduct;

      score += trendProductBoost.get(id) ?? 0;
      if (digestProductBoost.has(id)) score += W.digestProduct;
      if (storeId && digestStoreBoost.has(storeId)) score += W.digestStore;

      if (storeId && subscribedStoreBoost.has(storeId)) {
        score += W.subscribedStore;
      }
      if (storeId) {
        const planSort = planSortByStore.get(storeId) ?? 1;
        score += Math.max(0, planSort) * W.vendorPlanSortOrder;
      }

      const title = String(p.title ?? '');
      const bio = String(p.bio ?? '');
      let sb = searchBoostFor(
        title,
        bio,
        digestSearchTerms,
        W.searchDigestMatch,
      );
      if (sb === 0) {
        sb = searchBoostFor(title, bio, globalSearchTerms, W.searchGlobalMatch);
      }
      score += sb;

      return score;
    };

    const scored = candidates.map((p) => ({ p, s: scoreOne(p) }));
    scored.sort((a, b) => b.s - a.s);
    const products = scored.slice(0, take).map((x) => x.p);

    const storeIdsFromProducts = new Set<string>();
    for (const p of products) {
      const st = p.store as Record<string, unknown> | undefined;
      if (!st) continue;
      const sid = String(st.id ?? st._id ?? '').trim();
      if (sid) storeIdsFromProducts.add(sid);
    }

    const extraBoostStores = (snapshot?.trendStoreIds ?? [])
      .map((x) => String(x))
      .filter((id) => Types.ObjectId.isValid(id))
      .slice(0, 28);

    const stores = await this._trendingStores(
      12,
      [
        ...storeIdsFromProducts,
        ...extraBoostStores,
        ...subscribedStoreIds,
      ],
      {
        planSortByStore,
        subscribedStoreIds: subscribedStoreBoost,
        planSortWeight: W.vendorPlanSortOrder,
        subscribedWeight: W.subscribedStore,
      },
    );
    const drinkStorePool = [
      ...new Set([
        ...storeIdsFromProducts,
        ...stores.map((s) => String(s.id)),
        ...extraBoostStores,
      ]),
    ].slice(0, 24);

    let drinks = await this._drinksForStores(drinkStorePool, 18);
    const trendDrinkOrder = (snapshot?.trendDrinkIds ?? []).map((x) =>
      String(x),
    );
    if (trendDrinkOrder.length) {
      const rank = new Map(trendDrinkOrder.map((id, idx) => [id, idx]));
      drinks = [...drinks].sort((a, b) => {
        const ra = rank.get(String(a.id)) ?? 9999;
        const rb = rank.get(String(b.id)) ?? 9999;
        return ra - rb;
      });
    }

    return { products, stores, drinks };
  }

  private async _trendingStores(
    limit: number,
    boostStoreIds: string[],
    opts?: {
      planSortByStore?: Map<string, number>;
      subscribedStoreIds?: Set<string>;
      planSortWeight?: number;
      subscribedWeight?: number;
    },
  ): Promise<Record<string, unknown>[]> {
    const boostOids = boostStoreIds
      .filter((id) => Types.ObjectId.isValid(id))
      .slice(0, 40)
      .map((id) => new Types.ObjectId(id));

    const preLimit = Math.max(limit * 6, 48);

    const rows = await this._storeModel
      .aggregate([
        {
          $match: {
            status: StoreStatusEnum.ACTIVE,
            acceptsOrders: { $ne: false },
          },
        },
        ...storeOwnerStripeOnboardedPipelineStages(),
        ...storeArticlesAvailabilityPipelineStages(),
        { $sort: { averageRating: -1, updatedAt: -1 } },
        /** Borne avant `$lookup` commandes — coût O(n×orders) sinon sur tout le parc boutiques. */
        { $limit: preLimit },
        {
          $lookup: {
            from: 'orders',
            let: { sid: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$store', '$$sid'] },
                  status: { $in: PAID_LIKE_STATUSES },
                },
              },
              { $count: 'n' },
            ],
            as: '_ord',
          },
        },
        {
          $addFields: {
            orderCount: {
              $ifNull: [{ $arrayElemAt: ['$_ord.n', 0] }, 0],
            },
            likeCount: { $size: { $ifNull: ['$likedBy', []] } },
            boost: {
              $cond: [{ $in: ['$_id', boostOids] }, 18, 0],
            },
          },
        },
        {
          $addFields: {
            rankScore: {
              $add: [
                { $multiply: ['$orderCount', 2.2] },
                '$likeCount',
                { $multiply: [{ $ifNull: ['$averageRating', 0] }, 3] },
                '$boost',
              ],
            },
          },
        },
        { $sort: { rankScore: -1, likeCount: -1, updatedAt: -1 } },
        { $limit: preLimit },
        {
          $project: {
            _id: 1,
            name: 1,
            profileImage: 1,
            averageRating: 1,
            orderCount: 1,
            likeCount: 1,
            rankScore: 1,
          },
        },
      ])
      .option({ allowDiskUse: true })
      .exec();

    const planSortByStore = opts?.planSortByStore;
    const subscribedStoreIds = opts?.subscribedStoreIds;
    const planSortWeight = opts?.planSortWeight ?? 0;
    const subscribedWeight = opts?.subscribedWeight ?? 0;

    let storePlanSort = planSortByStore;
    if (!storePlanSort || subscribedWeight > 0) {
      const rowIds = (rows as Record<string, unknown>[]).map((s) =>
        String(s._id ?? ''),
      );
      const missingPlanIds = storePlanSort
        ? rowIds.filter((id) => !storePlanSort!.has(id))
        : rowIds;
      if (missingPlanIds.length) {
        const fetched =
          await this._subscriptions.resolveActivePlanSortOrderByStoreIds(
            missingPlanIds,
          );
        storePlanSort = new Map([...(storePlanSort ?? []), ...fetched]);
      }
    }

    const rescored = (rows as Record<string, unknown>[]).map((s) => {
      const id = String(s._id ?? '');
      let rankScore = Number(s.rankScore ?? 0);
      if (storePlanSort && planSortWeight > 0) {
        rankScore += Math.max(0, storePlanSort.get(id) ?? 1) * planSortWeight;
      }
      if (subscribedStoreIds?.has(id) && subscribedWeight > 0) {
        rankScore += subscribedWeight;
      }
      return { ...s, rankScore } as Record<string, unknown>;
    });

    rescored.sort((a, b) => {
      const diff = Number(b.rankScore ?? 0) - Number(a.rankScore ?? 0);
      if (diff !== 0) return diff;
      return Number(b.likeCount ?? 0) - Number(a.likeCount ?? 0);
    });

    return rescored.slice(0, limit).map((s) => ({
      id: String(s._id),
      name: String(s.name ?? ''),
      logo: String(s.profileImage ?? ''),
      rating: Number(s.averageRating ?? 0),
      salesCount: Number(s.orderCount ?? 0),
      likesCount: Number(s.likeCount ?? 0),
      verify: true,
    }));
  }

  private async _drinksForStores(
    storeIds: string[],
    maxItems: number,
  ): Promise<Record<string, unknown>[]> {
    const drinks = await this._drinksService.findByStoresForCatalog(
      storeIds,
      maxItems,
    );
    if (!drinks.length) return [];

    const storeOids = [
      ...new Set(
        storeIds.filter((id) => Types.ObjectId.isValid(id)).map((id) => id),
      ),
    ];
    const storeNameById = new Map<string, string>();
    if (storeOids.length) {
      const stores = await this._storeModel
        .find({
          _id: {
            $in: storeOids.map((id) => new Types.ObjectId(id)),
          },
        })
        .select('name')
        .lean()
        .exec();
      for (const s of stores) {
        storeNameById.set(String(s._id), String(s.name ?? ''));
      }
    }

    return drinks.map((d) => ({
      id: d.id,
      name: d.name,
      priceCad: d.priceCad,
      imageUrl: d.imageUrl ?? '',
      storeId: d.storeId,
      storeName: storeNameById.get(d.storeId) ?? '',
    }));
  }
}
