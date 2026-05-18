import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
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
  ) {}

  /** Pass complet : snapshot global + digests pour les utilisateurs actifs récents. */
  async runTrainingPass(): Promise<void> {
    const t0 = Date.now();
    const signalDays = Number(process.env.RECOMMENDATION_SIGNAL_LOOKBACK_DAYS) || 30;
    const digestDays = Number(process.env.RECOMMENDATION_DIGEST_LOOKBACK_DAYS) || 14;
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
          { $limit: 100 },
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

    const trendProductIds = [...productScore.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id)
      .slice(0, 220);

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

    const trendStoreIds = [...storeScore.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id)
      .slice(0, 80);

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

    await this._digestModel.updateOne(
      { user: userOid },
      {
        $set: {
          user: userOid,
          computedAt: new Date(),
          topViewedProductIds: prods.map((x) => String(x._id)),
          topViewedStoreIds: stores.map((x) => String(x._id)),
          topSearchTerms,
        },
      },
      { upsert: true },
    );
  }
}
