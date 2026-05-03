import { SearchService } from '@modules/search/search.service';
import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DrinkModel, DrinkStatutEnum } from '@schemas/drink.schema';
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

const PAID_LIKE_STATUSES: OrderStatusEnum[] = [
  OrderStatusEnum.PAIED,
  OrderStatusEnum.APPROVED,
  OrderStatusEnum.SHIPPED,
  OrderStatusEnum.COMPLETED,
];

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly _search: SearchService,
    @InjectModel(UserRecommendationSignalModel.name)
    private readonly _signalModel: Model<UserRecommendationSignalModel>,
    @InjectModel(DrinkModel.name)
    private readonly _drinkModel: Model<DrinkModel>,
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

  /** Poids du scoring fil (surcharge via variables d’environnement). */
  private _scoreWeights(): {
    perLike: number;
    perRating: number;
    recencyDivisor: number;
    favProduct: number;
    favStore: number;
    viewedStore: number;
    viewedProduct: number;
    favCategory: number;
    ratedProduct: number;
    digestProduct: number;
    digestStore: number;
    trendProductMax: number;
    trendProductDecay: number;
    searchDigestMatch: number;
    searchGlobalMatch: number;
  } {
    const n = (key: string, def: number, min = 0): number => {
      const v = Number(process.env[key]);
      return Number.isFinite(v) && v >= min ? v : def;
    };
    return {
      perLike: n('RECO_SCORE_PER_LIKE', 0.12),
      perRating: n('RECO_SCORE_PER_RATING', 2.8),
      recencyDivisor: Math.max(1, n('RECO_SCORE_RECENCY_DIVISOR', 400, 1)),
      favProduct: n('RECO_WEIGHT_FAV_PRODUCT', 85),
      favStore: n('RECO_WEIGHT_FAV_STORE', 42),
      viewedStore: n('RECO_WEIGHT_VIEWED_STORE', 28),
      viewedProduct: n('RECO_WEIGHT_VIEWED_PRODUCT', 22),
      favCategory: n('RECO_WEIGHT_FAV_CATEGORY', 24),
      ratedProduct: n('RECO_WEIGHT_RATED_PRODUCT', 32),
      digestProduct: n('RECO_WEIGHT_DIGEST_PRODUCT', 14),
      digestStore: n('RECO_WEIGHT_DIGEST_STORE', 18),
      trendProductMax: n('RECO_TREND_PRODUCT_BOOST_MAX', 38),
      trendProductDecay: n('RECO_TREND_PRODUCT_BOOST_DECAY', 0.15),
      searchDigestMatch: n('RECO_WEIGHT_SEARCH_DIGEST', 6),
      searchGlobalMatch: n('RECO_WEIGHT_SEARCH_GLOBAL', 3),
    };
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

    const W = this._scoreWeights();
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
      const st = p.store as Record<string, unknown> | undefined;
      const storeId = st ? String(st.id ?? st._id ?? '') : '';
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

      const title = String(p.title ?? '');
      const bio = String(p.bio ?? '');
      let sb = searchBoostFor(
        title,
        bio,
        digestSearchTerms,
        W.searchDigestMatch,
      );
      if (sb === 0) {
        sb = searchBoostFor(
          title,
          bio,
          globalSearchTerms,
          W.searchGlobalMatch,
        );
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

    const stores = await this._trendingStores(12, [
      ...storeIdsFromProducts,
      ...extraBoostStores,
    ]);
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
  ): Promise<Record<string, unknown>[]> {
    const boostOids = boostStoreIds
      .filter((id) => Types.ObjectId.isValid(id))
      .slice(0, 40)
      .map((id) => new Types.ObjectId(id));

    const rows = await this._storeModel
      .aggregate([
        {
          $match: {
            status: StoreStatusEnum.ACTIVE,
            acceptsOrders: { $ne: false },
          },
        },
        { $sort: { averageRating: -1, updatedAt: -1 } },
        /** Borne avant `$lookup` commandes — coût O(n×orders) sinon sur tout le parc boutiques. */
        { $limit: 160 },
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
              $cond: [
                { $in: ['$_id', boostOids] },
                18,
                0,
              ],
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
        { $limit: limit },
        {
          $project: {
            _id: 1,
            name: 1,
            profileImage: 1,
            averageRating: 1,
            orderCount: 1,
            likeCount: 1,
          },
        },
      ])
      .option({ allowDiskUse: true })
      .exec();

    return rows.map((s) => ({
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
    const oids = storeIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (!oids.length) return [];

    const rows = await this._drinkModel
      .find({
        store: { $in: oids },
        statut: DrinkStatutEnum.OK,
      })
      .sort({ updatedAt: -1 })
      .limit(maxItems)
      .populate({ path: 'store', select: 'name' })
      .lean()
      .exec();

    return rows.map((d) => {
      const doc = d as unknown as {
        _id: Types.ObjectId;
        name?: string;
        priceCad?: number;
        imageUrl?: string;
        store?: Types.ObjectId | { _id?: Types.ObjectId; name?: string };
      };
      let sid = '';
      let storeName = '';
      const stRaw = doc.store;
      if (stRaw != null && typeof stRaw === 'object' && !(stRaw instanceof Types.ObjectId)) {
        const st = stRaw as { _id?: Types.ObjectId; name?: string };
        if (st._id) sid = String(st._id);
        if (st.name != null) storeName = String(st.name);
      } else if (stRaw != null) {
        sid = String(stRaw);
      }
      return {
        id: String(doc._id),
        name: String(doc.name ?? ''),
        priceCad: Number(doc.priceCad ?? 0),
        imageUrl: String(doc.imageUrl ?? ''),
        storeId: sid,
        storeName,
      };
    });
  }
}
