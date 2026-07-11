import { SearchSettingsService } from '@modules/search-settings/search-settings.service';
import {
  normalizeCountryCode,
  storeDirectRegionMatch,
} from '@modules/supported-countries/client-market-region.util';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ModuleCacheLayerService } from '@common/cache/module-cache-layer.service';
import { DRINK_IN_STOCK_FILTER } from '@modules/drinks/drinks.service';
import { DrinkModel } from '@schemas/drink.schema';
import {
  RecommendationTrainingSnapshotModel,
  RECOMMENDATION_GLOBAL_SNAPSHOT_KEY,
} from '@schemas/recommendation-training-snapshot.schema';
import { OrderStatusEnum } from '@schemas/order.schema';
import { ProductModel, ProductStatusEnum } from '@schemas/product.schema';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import {
  UserRecommendationSignalKind,
  UserRecommendationSignalModel,
} from '@schemas/user-recommendation-signal.schema';
import { UserRecommendationDigestModel } from '@schemas/user-recommendation-digest.schema';
import { Model, Types } from 'mongoose';

const PAID_LIKE: OrderStatusEnum[] = [
  OrderStatusEnum.PAIED,
  OrderStatusEnum.APPROVED,
  OrderStatusEnum.SHIPPED,
  OrderStatusEnum.COMPLETED,
];

/**
 * Agrège les données comportementales (vues, tendances catalogue) et met à jour
 * le snapshot global + digests utilisateur. Pensé comme un « mini-entraînement »
 * batch (scores / classements) sans pipeline ML externe.
 */
@Injectable()
export class RecommendationTrainingService {
  private readonly _logger = new Logger(RecommendationTrainingService.name);

  constructor(
    @InjectModel(UserRecommendationSignalModel.name)
    private readonly _signalModel: Model<UserRecommendationSignalModel>,
    @InjectModel(ProductModel.name)
    private readonly _productModel: Model<ProductModel>,
    @InjectModel(StoreModel.name)
    private readonly _storeModel: Model<StoreModel>,
    @InjectModel(DrinkModel.name)
    private readonly _drinkModel: Model<DrinkModel>,
    @InjectModel(RecommendationTrainingSnapshotModel.name)
    private readonly _snapshotModel: Model<RecommendationTrainingSnapshotModel>,
    @InjectModel(UserRecommendationDigestModel.name)
    private readonly _digestModel: Model<UserRecommendationDigestModel>,
    private readonly _searchSettings: SearchSettingsService,
    private readonly _cacheLayer: ModuleCacheLayerService,
  ) {}

  /** Pass complet : snapshot global + digests pour les utilisateurs actifs récents. */
  async runTrainingPass(): Promise<void> {
    const t0 = Date.now();
    const runtime = await this._searchSettings.getSearchRuntimeConfig();
    const signalDays = runtime.trainingLookbackDays;
    const digestDays = runtime.digestLookbackDays;
    const maxDigestUsers =
      Number(process.env.RECOMMENDATION_DIGEST_MAX_USERS) || 800;
    const digestUserMinSignals =
      Number(process.env.RECOMMENDATION_DIGEST_MIN_SIGNALS) || 2;

    const sinceSignal = new Date(Date.now() - signalDays * 86400000);
    const sinceDigest = new Date(Date.now() - digestDays * 86400000);

    const [
      topViewedProducts,
      topViewedStores,
      topLikedProducts,
      topOrderStores,
    ] = await Promise.all([
      this._signalModel
        .aggregate<{ _id: Types.ObjectId; c: number }>([
          {
            $match: {
              kind: UserRecommendationSignalKind.PRODUCT_VIEW,
              createdAt: { $gte: sinceSignal },
            },
          },
          { $group: { _id: '$refId', c: { $sum: 1 } } },
          { $sort: { c: -1 } },
          { $limit: 160 },
        ])
        .exec(),
      this._signalModel
        .aggregate<{ _id: Types.ObjectId; c: number }>([
          {
            $match: {
              kind: UserRecommendationSignalKind.STORE_VIEW,
              createdAt: { $gte: sinceSignal },
            },
          },
          { $group: { _id: '$refId', c: { $sum: 1 } } },
          { $sort: { c: -1 } },
          { $limit: 140 },
          {
            $lookup: {
              from: 'stores',
              localField: '_id',
              foreignField: '_id',
              as: '_store',
            },
          },
          {
            $match: {
              '_store.0.status': StoreStatusEnum.ACTIVE,
              '_store.0.acceptsOrders': { $ne: false },
            },
          },
          { $limit: 100 },
          { $project: { _id: 1, c: 1 } },
        ])
        .exec(),
      this._productModel
        .aggregate<{ _id: Types.ObjectId; likes: number }>([
          {
            $match: { status: ProductStatusEnum.ACTIVE },
          },
          {
            $lookup: {
              from: 'stores',
              localField: 'store',
              foreignField: '_id',
              as: '_st',
            },
          },
          { $addFields: { _store: { $arrayElemAt: ['$_st', 0] } } },
          {
            $match: {
              '_store.acceptsOrders': true,
              '_store.status': StoreStatusEnum.ACTIVE,
            },
          },
          {
            $addFields: {
              likes: { $size: { $ifNull: ['$likedBy', []] } },
            },
          },
          { $sort: { likes: -1, updatedAt: -1 } },
          { $limit: 120 },
          { $project: { _id: 1, likes: 1 } },
        ])
        .option({ allowDiskUse: true })
        .exec(),
      this._storeModel
        .aggregate<{ _id: Types.ObjectId; orderCount: number }>([
          {
            $match: {
              status: StoreStatusEnum.ACTIVE,
              acceptsOrders: { $ne: false },
            },
          },
          {
            $lookup: {
              from: 'orders',
              let: { sid: '$_id' },
              pipeline: [
                {
                  $match: {
                    $expr: { $eq: ['$store', '$$sid'] },
                    status: { $in: PAID_LIKE },
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
            },
          },
          { $sort: { orderCount: -1, updatedAt: -1 } },
          { $limit: 60 },
          { $project: { _id: 1, orderCount: 1 } },
        ])
        .option({ allowDiskUse: true })
        .exec(),
    ]);

    const productScore = new Map<string, number>();
    const bump = (id: string, delta: number) => {
      if (!Types.ObjectId.isValid(id)) return;
      productScore.set(id, (productScore.get(id) ?? 0) + delta);
    };

    topViewedProducts.forEach((row, i) => {
      bump(String(row._id), 6 * Number(row.c ?? 0) + (160 - i) * 0.08);
    });
    topLikedProducts.forEach((row, i) => {
      bump(String(row._id), 4 * Number(row.likes ?? 0) + (120 - i) * 0.15);
    });

    const storeScore = new Map<string, number>();
    const bumpStore = (id: string, delta: number) => {
      if (!Types.ObjectId.isValid(id)) return;
      storeScore.set(id, (storeScore.get(id) ?? 0) + delta);
    };
    topViewedStores.forEach((row, i) => {
      bumpStore(String(row._id), 5 * Number(row.c ?? 0) + (100 - i) * 0.1);
    });
    topOrderStores.forEach((row, i) => {
      bumpStore(
        String(row._id),
        3.5 * Number(row.orderCount ?? 0) + (60 - i) * 0.2,
      );
    });

    const trendStoreIds = await this._sanitizeActiveStoreIds(
      [...storeScore.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id),
      80,
    );

    const trendStoreIdsByRegion = await this._buildTrendStoreIdsByRegion(
      storeScore,
      40,
    );

    const trendProductIds = await this._sanitizeActiveProductIds(
      [...productScore.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([id]) => id),
      220,
    );

    const storeOidSet = trendStoreIds
      .filter((id) => Types.ObjectId.isValid(id))
      .slice(0, 28)
      .map((id) => new Types.ObjectId(id));

    const drinkRows = storeOidSet.length
      ? await this._drinkModel
          .find({
            store: { $in: storeOidSet },
            ...DRINK_IN_STOCK_FILTER,
          })
          .sort({ updatedAt: -1 })
          .limit(120)
          .select('_id')
          .lean()
          .exec()
      : [];

    const trendDrinkIds = drinkRows.map((d) =>
      String((d as unknown as { _id: Types.ObjectId })._id),
    );

    const topGlobalSearches = await this._signalModel
      .aggregate<{ _id: string; c: number }>([
        {
          $match: {
            kind: UserRecommendationSignalKind.SEARCH_QUERY,
            createdAt: { $gte: sinceSignal },
            searchTerm: { $type: 'string', $ne: '' },
          },
        },
        { $group: { _id: '$searchTerm', c: { $sum: 1 } } },
        { $sort: { c: -1 } },
        { $limit: 40 },
      ])
      .exec();
    const trendSearchQueries = topGlobalSearches
      .map((r) => String(r._id ?? '').trim())
      .filter((s) => s.length >= 2);

    const digestUserRows = await this._signalModel
      .aggregate<{ _id: Types.ObjectId; n: number }>([
        { $match: { createdAt: { $gte: sinceDigest } } },
        { $group: { _id: '$user', n: { $sum: 1 } } },
        { $match: { n: { $gte: digestUserMinSignals } } },
        { $sort: { n: -1 } },
        { $limit: maxDigestUsers },
      ])
      .exec();

    let digestsWritten = 0;
    const chunk = 48;
    for (let i = 0; i < digestUserRows.length; i += chunk) {
      const slice = digestUserRows.slice(i, i + chunk);
      await Promise.all(
        slice.map(async (row) => {
          try {
            await this._refreshDigestForUser(row._id, sinceDigest);
            digestsWritten += 1;
          } catch (e) {
            this._logger.warn(
              `digest user=${String(row._id)}: ${(e as Error).message}`,
            );
          }
        }),
      );
    }

    const durationMs = Date.now() - t0;
    await this._snapshotModel.findOneAndUpdate(
      { docKey: RECOMMENDATION_GLOBAL_SNAPSHOT_KEY },
      {
        $set: {
          docKey: RECOMMENDATION_GLOBAL_SNAPSHOT_KEY,
          computedAt: new Date(),
          trendProductIds,
          trendStoreIds,
          trendStoreIdsByRegion,
          trendDrinkIds,
          trendSearchQueries,
          runMeta: {
            durationMs,
            signalDays,
            digestDays,
            digestUsersScanned: digestUserRows.length,
            digestsWritten,
            topViewedProducts: topViewedProducts.length,
            topLikedProducts: topLikedProducts.length,
            topOrderStores: topOrderStores.length,
            globalSearchSignals: topGlobalSearches.length,
          },
        },
      },
      { upsert: true, new: true },
    );

    this._logger.log(
      `recommendation training ok in ${durationMs}ms (products=${trendProductIds.length}, stores=${trendStoreIds.length}, drinks=${trendDrinkIds.length}, digests=${digestsWritten})`,
    );
    void this._cacheLayer.bustAllRecommendationFeeds();
  }

  /** Conserve l’ordre de pertinence ; exclut les ids invalides ou boutiques absentes / inactives. */
  private async _sanitizeActiveStoreIds(
    orderedIds: string[],
    limit: number,
  ): Promise<string[]> {
    const candidates = orderedIds.filter((id) => Types.ObjectId.isValid(id));
    if (!candidates.length) return [];
    const found = await this._storeModel
      .find({
        _id: { $in: candidates.map((id) => new Types.ObjectId(id)) },
        status: StoreStatusEnum.ACTIVE,
        acceptsOrders: { $ne: false },
      })
      .select('_id')
      .lean()
      .exec();
    const foundSet = new Set(found.map((row) => String(row._id)));
    return candidates.filter((id) => foundSet.has(id)).slice(0, limit);
  }

  private async _sanitizeActiveProductIds(
    orderedIds: string[],
    limit: number,
  ): Promise<string[]> {
    const candidates = orderedIds.filter((id) => Types.ObjectId.isValid(id));
    if (!candidates.length) return [];
    const found = await this._productModel
      .find({
        _id: { $in: candidates.map((id) => new Types.ObjectId(id)) },
        status: ProductStatusEnum.ACTIVE,
      })
      .select('_id')
      .lean()
      .exec();
    const foundSet = new Set(found.map((row) => String(row._id)));
    return candidates.filter((id) => foundSet.has(id)).slice(0, limit);
  }

  /** Classements tendance par région ISO2 + complément catalogue local si peu de signaux. */
  private async _buildTrendStoreIdsByRegion(
    storeScore: Map<string, number>,
    limitPerRegion: number,
  ): Promise<Record<string, string[]>> {
    const scoredIds = [...storeScore.keys()].filter((id) =>
      Types.ObjectId.isValid(id),
    );
    const byRegion = new Map<string, string[]>();

    if (scoredIds.length) {
      const stores = await this._storeModel
        .find({
          _id: { $in: scoredIds.map((id) => new Types.ObjectId(id)) },
          status: StoreStatusEnum.ACTIVE,
          acceptsOrders: { $ne: false },
        })
        .select('_id region')
        .lean()
        .exec();

      const grouped = new Map<string, Array<{ id: string; score: number }>>();
      for (const row of stores) {
        const region = normalizeCountryCode(String(row.region ?? ''));
        if (!region) continue;
        const id = String(row._id);
        const score = storeScore.get(id) ?? 0;
        const bucket = grouped.get(region) ?? [];
        bucket.push({ id, score });
        grouped.set(region, bucket);
      }

      for (const [region, rows] of grouped) {
        rows.sort((a, b) => b.score - a.score);
        byRegion.set(
          region,
          rows.map((row) => row.id).slice(0, limitPerRegion),
        );
      }
    }

    const activeRegions = await this._storeModel
      .distinct('region', {
        status: StoreStatusEnum.ACTIVE,
        acceptsOrders: { $ne: false },
        region: { $exists: true, $type: 'string', $nin: [null, ''] },
      })
      .exec();

    for (const regionRaw of activeRegions) {
      const region = normalizeCountryCode(String(regionRaw ?? ''));
      if (!region) continue;
      if ((byRegion.get(region)?.length ?? 0) >= 8) continue;

      const topInRegion = await this._storeModel
        .find({
          status: StoreStatusEnum.ACTIVE,
          acceptsOrders: { $ne: false },
          ...storeDirectRegionMatch(region),
        })
        .sort({ averageRating: -1, updatedAt: -1 })
        .limit(limitPerRegion)
        .select('_id')
        .lean()
        .exec();

      const merged = [...(byRegion.get(region) ?? [])];
      const seen = new Set(merged);
      for (const row of topInRegion) {
        const id = String(row._id);
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push(id);
        if (merged.length >= limitPerRegion) break;
      }
      if (merged.length) {
        byRegion.set(region, merged);
      }
    }

    return Object.fromEntries(byRegion);
  }

  private async _refreshDigestForUser(
    userOid: Types.ObjectId,
    since: Date,
  ): Promise<void> {
    const [prods, stores, searches] = await Promise.all([
      this._signalModel
        .aggregate<{ _id: Types.ObjectId; c: number }>([
          {
            $match: {
              user: userOid,
              kind: UserRecommendationSignalKind.PRODUCT_VIEW,
              createdAt: { $gte: since },
            },
          },
          { $group: { _id: '$refId', c: { $sum: 1 } } },
          { $sort: { c: -1 } },
          { $limit: 28 },
        ])
        .exec(),
      this._signalModel
        .aggregate<{ _id: Types.ObjectId; c: number }>([
          {
            $match: {
              user: userOid,
              kind: UserRecommendationSignalKind.STORE_VIEW,
              createdAt: { $gte: since },
            },
          },
          { $group: { _id: '$refId', c: { $sum: 1 } } },
          { $sort: { c: -1 } },
          { $limit: 16 },
        ])
        .exec(),
      this._signalModel
        .aggregate<{ _id: string; c: number }>([
          {
            $match: {
              user: userOid,
              kind: UserRecommendationSignalKind.SEARCH_QUERY,
              createdAt: { $gte: since },
              searchTerm: { $type: 'string', $ne: '' },
            },
          },
          { $group: { _id: '$searchTerm', c: { $sum: 1 } } },
          { $sort: { c: -1 } },
          { $limit: 16 },
        ])
        .exec(),
    ]);

    const topSearchTerms = searches
      .map((x) => String(x._id ?? '').trim())
      .filter((s) => s.length >= 2);

    const topViewedProductIds = await this._sanitizeActiveProductIds(
      prods.map((x) => String(x._id)),
      28,
    );
    const topViewedStoreIds = await this._sanitizeActiveStoreIds(
      stores.map((x) => String(x._id)),
      16,
    );

    await this._digestModel.updateOne(
      { user: userOid },
      {
        $set: {
          user: userOid,
          computedAt: new Date(),
          topViewedProductIds,
          topViewedStoreIds,
          topSearchTerms,
        },
      },
      { upsert: true },
    );
  }
}
