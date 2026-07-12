import { storeOwnerStripeOnboardedPipelineStages } from '@modules/billing/stripe/stripe-connect-visibility';
import { DrinksService } from '@modules/drinks/drinks.service';
import { SearchService } from '@modules/search/search.service';
import { StoreSubscribersService } from '@modules/store-subscribers/store-subscribers.service';
import { SearchSettingsService } from '@modules/search-settings/search-settings.service';
import { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import {
  normalizeCountryCode,
  storeDirectRegionMatch,
} from '@modules/supported-countries/client-market-region.util';
import { BadRequestException, Injectable, Inject, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ModuleCacheLayerService } from '@common/cache/module-cache-layer.service';
import {
  AppCacheKeys,
  cacheUserScope,
  recommendationsCacheTtlMs,
} from '@common/redis-app-cache';
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
import { TrackRecommendationDto } from './dto/track-recommendation.dto';
import { RecommendationFacade } from '@modules/graph/recommendation-facade.service';
import { GraphSyncQueueService } from '@modules/graph/graph-sync-queue.service';

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
    private readonly _supportedCountries: SupportedCountriesService,
    private readonly _cacheLayer: ModuleCacheLayerService,
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
    @Optional()
    private readonly _recoFacade?: RecommendationFacade,
    @Optional()
    private readonly _graphSyncQueue?: GraphSyncQueueService,
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
    void this._cacheLayer.bustRecommendationFeedsForUser(
      cacheUserScope(user),
    );

    if (this._graphSyncQueue) {
      const kind =
        dto.kind === UserRecommendationSignalKind.STORE_VIEW
          ? 'store_view'
          : dto.kind === UserRecommendationSignalKind.SEARCH_QUERY
            ? 'search_query'
            : 'product_view';
      void this._graphSyncQueue
        .enqueueSignalTracked({
          userId: userOid.toHexString(),
          kind,
          refId: refOid.toHexString(),
          ...(searchStored != null ? { searchTerm: searchStored } : {}),
          at: new Date().toISOString(),
        })
        .catch(() => undefined);
    }
  }

  /** Bust feeds reco pour un user (order completed, etc.). */
  async bustFeedCacheForUser(userId: string | undefined | null): Promise<void> {
    const id = String(userId ?? '').trim();
    if (!id) return;
    await this._cacheLayer.bustRecommendationFeedsForUser(id);
  }

  /** Bust global (après training snapshot). */
  async bustAllFeedCaches(): Promise<void> {
    await this._cacheLayer.bustAllRecommendationFeeds();
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
    countryCode?: string,
  ): Promise<{
    products: Record<string, unknown>[];
    stores: Record<string, unknown>[];
    drinks: Record<string, unknown>[];
  }> {
    const take = Math.min(48, Math.max(4, parseInt(takeRaw ?? '24', 10) || 24));
    const clientRegion =
      (await this._supportedCountries.resolveOptionalClientCatalogRegion(
        user,
        countryCode,
      )) ?? '';

    // Shop-home passe des candidats déjà chargés : ne pas cacher une clé partielle.
    if (productCandidates != null && productCandidates.length > 0) {
      return this._computeFeed(user, take, productCandidates, clientRegion);
    }

    const key = AppCacheKeys.recoFeed(
      cacheUserScope(user),
      clientRegion,
      take,
    );
    return this._cacheLayer.getOrSet(
      'recommendations',
      key,
      recommendationsCacheTtlMs(),
      () => this._computeFeed(user, take, undefined, clientRegion),
    );
  }

  private async _computeFeed(
    user: UserModel | undefined,
    take: number,
    productCandidates: Record<string, unknown>[] | undefined,
    clientRegion: string,
  ): Promise<{
    products: Record<string, unknown>[];
    stores: Record<string, unknown>[];
    drinks: Record<string, unknown>[];
  }> {
    const poolLimit = Math.min(120, Math.max(take * 4, 60));

    const userOid = this._userOid(user);

    const [candidates, snapshot, digestDoc] = await Promise.all([
      productCandidates != null && productCandidates.length > 0
        ? Promise.resolve(productCandidates)
        : this._search.homeFeedProducts(user, poolLimit, clientRegion),
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
    const [planSortByStore, planScoreByStore, subscribedStoreIds] =
      await Promise.all([
      this._subscriptions.resolveActivePlanSortOrderByStoreIds(
        candidateStoreIds,
      ),
      this._subscriptions.resolveActivePlanScoreByStoreIds(candidateStoreIds),
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
        const planScore = planScoreByStore.get(storeId) ?? 0;
        score += (Math.max(0, planScore) / 100) * W.vendorPlanScore;
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

    const extraBoostStores = await this._resolveTrendStoreBoostIds(
      snapshot as Record<string, unknown> | null,
      clientRegion,
    );

    let graphBoostStores: string[] = [];
    if (userOid && this._recoFacade) {
      const graphIds = await this._recoFacade.personalizedStoreIdsOrNull({
        userId: userOid.toHexString(),
        region: clientRegion,
        limit: 12,
      });
      if (graphIds?.length) {
        graphBoostStores = await this._filterActiveStoreIdsForRegion(
          graphIds,
          clientRegion,
          12,
        );
      }
    }

    const stores = await this._trendingStores(
      12,
      [
        ...graphBoostStores,
        ...storeIdsFromProducts,
        ...extraBoostStores,
        ...subscribedStoreIds,
      ],
      {
        planSortByStore,
        planScoreByStore,
        subscribedStoreIds: subscribedStoreBoost,
        planSortWeight: W.vendorPlanSortOrder,
        planScoreWeight: W.vendorPlanScore,
        subscribedWeight: W.subscribedStore,
      },
      clientRegion,
    );
    const drinkStorePool = [
      ...new Set([
        ...storeIdsFromProducts,
        ...stores.map((s) => String(s.id)),
        ...extraBoostStores,
      ]),
    ].slice(0, 24);

    let drinks = await this._drinksForStores(drinkStorePool, 18, clientRegion);
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

  private _readRegionalTrendStoreIds(
    snapshot: Record<string, unknown> | null | undefined,
    clientRegion: string,
  ): string[] {
    const code = normalizeCountryCode(clientRegion);
    if (!code || !snapshot) return [];
    const raw = snapshot.trendStoreIdsByRegion as
      | Map<string, string[]>
      | Record<string, string[]>
      | undefined;
    if (!raw) return [];
    const list =
      raw instanceof Map ? raw.get(code) : (raw as Record<string, string[]>)[code];
    return (list ?? [])
      .map((id) => String(id))
      .filter((id) => Types.ObjectId.isValid(id))
      .slice(0, 28);
  }

  private async _filterActiveStoreIdsForRegion(
    storeIds: string[],
    clientRegion?: string,
    limit = 28,
  ): Promise<string[]> {
    const ordered = storeIds.filter((id) => Types.ObjectId.isValid(id));
    if (!ordered.length) return [];
    const query: Record<string, unknown> = {
      _id: { $in: ordered.map((id) => new Types.ObjectId(id)) },
      status: StoreStatusEnum.ACTIVE,
      acceptsOrders: { $ne: false },
    };
    if (clientRegion) {
      Object.assign(query, storeDirectRegionMatch(clientRegion));
    }
    const rows = await this._storeModel
      .find(query)
      .select('_id')
      .lean()
      .exec();
    const found = new Set(rows.map((row) => String(row._id)));
    return ordered.filter((id) => found.has(id)).slice(0, limit);
  }

  private async _resolveTrendStoreBoostIds(
    snapshot: Record<string, unknown> | null | undefined,
    clientRegion: string,
  ): Promise<string[]> {
    const regional = this._readRegionalTrendStoreIds(snapshot, clientRegion);
    if (regional.length) {
      return this._filterActiveStoreIdsForRegion(regional, clientRegion);
    }
    const global = ((snapshot?.trendStoreIds as string[] | undefined) ?? [])
      .map((id) => String(id))
      .filter((id) => Types.ObjectId.isValid(id));
    return this._filterActiveStoreIdsForRegion(global, clientRegion);
  }

  private async _trendingStores(
    limit: number,
    boostStoreIds: string[],
    opts?: {
      planSortByStore?: Map<string, number>;
      planScoreByStore?: Map<string, number>;
      subscribedStoreIds?: Set<string>;
      planSortWeight?: number;
      planScoreWeight?: number;
      subscribedWeight?: number;
    },
    clientRegion?: string,
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
            ...(clientRegion ? storeDirectRegionMatch(clientRegion) : {}),
          },
        },
        ...storeOwnerStripeOnboardedPipelineStages(),
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
    const planScoreByStore = opts?.planScoreByStore;
    const subscribedStoreIds = opts?.subscribedStoreIds;
    const planSortWeight = opts?.planSortWeight ?? 0;
    const planScoreWeight = opts?.planScoreWeight ?? 0;
    const subscribedWeight = opts?.subscribedWeight ?? 0;

    let storePlanSort = planSortByStore;
    let storePlanScore = planScoreByStore;
    if (
      !storePlanSort ||
      !storePlanScore ||
      subscribedWeight > 0
    ) {
      const rowIds = (rows as Record<string, unknown>[]).map((s) =>
        String(s._id ?? ''),
      );
      const missingPlanSortIds = storePlanSort
        ? rowIds.filter((id) => !storePlanSort!.has(id))
        : planSortWeight > 0
          ? rowIds
          : [];
      const missingPlanScoreIds = storePlanScore
        ? rowIds.filter((id) => !storePlanScore!.has(id))
        : planScoreWeight > 0
          ? rowIds
          : [];
      const missingIds = [
        ...new Set([...missingPlanSortIds, ...missingPlanScoreIds]),
      ];
      if (missingIds.length) {
        const [fetchedSort, fetchedScore] = await Promise.all([
          missingPlanSortIds.length || !storePlanSort
            ? this._subscriptions.resolveActivePlanSortOrderByStoreIds(
                missingPlanSortIds.length ? missingPlanSortIds : missingIds,
              )
            : Promise.resolve(new Map<string, number>()),
          missingPlanScoreIds.length || !storePlanScore
            ? this._subscriptions.resolveActivePlanScoreByStoreIds(
                missingPlanScoreIds.length ? missingPlanScoreIds : missingIds,
              )
            : Promise.resolve(new Map<string, number>()),
        ]);
        if (fetchedSort.size) {
          storePlanSort = new Map([...(storePlanSort ?? []), ...fetchedSort]);
        }
        if (fetchedScore.size) {
          storePlanScore = new Map([...(storePlanScore ?? []), ...fetchedScore]);
        }
      }
    }

    const rescored = (rows as Record<string, unknown>[]).map((s) => {
      const id = String(s._id ?? '');
      let rankScore = Number(s.rankScore ?? 0);
      if (storePlanSort && planSortWeight > 0) {
        rankScore += Math.max(0, storePlanSort.get(id) ?? 1) * planSortWeight;
      }
      if (storePlanScore && planScoreWeight > 0) {
        const planScore = storePlanScore.get(id) ?? 0;
        rankScore += (Math.max(0, planScore) / 100) * planScoreWeight;
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
    clientRegion?: string,
  ): Promise<Record<string, unknown>[]> {
    const drinks = await this._drinksService.findByStoresForCatalog(
      storeIds,
      maxItems,
      clientRegion,
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
      quantite: d.quantite,
    }));
  }
}
