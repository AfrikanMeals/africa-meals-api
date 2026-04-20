import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { ProductRatingModel } from '@schemas/product_rating.schema';
import { StockItemModel, StockStatutEnum } from '@schemas/stock-item.schema';
import { StoreRatingModel } from '@schemas/store_rating.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';

/** Objectif CA affiché sur le tableau de bord admin (FCFA). */
const ADMIN_REVENUE_TARGET_FCFA = 500_000;
/** Objectif délai livraison affiché (minutes). */
const ADMIN_DELIVERY_TARGET_MIN = 25;
/** Commandes prises en compte pour le CA du jour (hors créées non payées et annulées). */
const ORDER_STATUSES_FOR_REVENUE: OrderStatusEnum[] = [
  OrderStatusEnum.PAIED,
  OrderStatusEnum.APPROVED,
  OrderStatusEnum.SHIPPED,
  OrderStatusEnum.COMPLETED,
];
/** Commandes encore actives (pipeline). */
const ORDER_STATUSES_IN_FLIGHT: OrderStatusEnum[] = [
  OrderStatusEnum.CREATED,
  OrderStatusEnum.PAIED,
  OrderStatusEnum.APPROVED,
  OrderStatusEnum.SHIPPED,
];

function trendPercent(current: number, previous: number): number | null {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Délai max (minutes) depuis la création avant de considérer la livraison en retard (pas d’ETA en base). */
const DELIVERY_SLA_MINUTES = 45;
/** Note ≤ seuil = avis négatif (échelle 1–5). */
const NEGATIVE_REVIEW_MAX_RATE = 2;
const REVIEW_WINDOW_MINUTES = 60;

function vendorStoreObjectIds(user: UserModel): Types.ObjectId[] {
  const rawStores = user.stores || [];
  const ids: Types.ObjectId[] = [];
  for (const s of rawStores) {
    if (typeof s === 'object' && s !== null && '_id' in s) {
      const id = (s as { _id: unknown })._id;
      ids.push(
        id instanceof Types.ObjectId ? id : new Types.ObjectId(String(id)),
      );
    } else if (s) {
      ids.push(new Types.ObjectId(String(s)));
    }
  }
  return ids;
}

function orderDisplayRef(orderId: unknown): string {
  const hex = String(orderId);
  const tail = hex.slice(-6).toUpperCase();
  return `#AE-${tail}`;
}

export type DelayedDeliveryAlert = {
  orderId: string;
  displayRef: string;
  minutesLate: number;
  storeName: string | null;
};

export type NegativeReviewStoreAlert = {
  storeId: string;
  storeName: string;
  count: number;
};

export type StockAlertRow = {
  id: string;
  produit: string;
  quantite: number;
  storeId: string;
  storeName: string | null;
};

export type AdminDashboardKpis = {
  revenueTodayFcfa: number;
  revenueYesterdayFcfa: number;
  revenueTrendPercent: number | null;
  ordersToday: number;
  ordersYesterday: number;
  ordersTrendPercent: number | null;
  ordersInProgress: number;
  newClientsToday: number;
  newClientsYesterday: number;
  newClientsTrendPercent: number | null;
  avgDeliveryMinutesToday: number | null;
  avgDeliveryMinutesYesterday: number | null;
  deliveryDeltaMinutes: number | null;
  revenueTargetFcfa: number;
  deliveryTargetMinutes: number;
};

@Injectable()
export class DashboardService {
  constructor(
    @InjectModel(OrderModel.name)
    private readonly orderModel: Model<OrderModel>,
    @InjectModel(StoreRatingModel.name)
    private readonly storeRatingModel: Model<StoreRatingModel>,
    @InjectModel(ProductRatingModel.name)
    private readonly productRatingModel: Model<ProductRatingModel>,
    @InjectModel(StockItemModel.name)
    private readonly stockItemModel: Model<StockItemModel>,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
  ) {}

  async getAlerts(user: UserModel): Promise<{
    delayedDeliveries: DelayedDeliveryAlert[];
    negativeReviewStores: NegativeReviewStoreAlert[];
    stockAlerts: StockAlertRow[];
  }> {
    if (
      user.type !== UserTypeEnum.ADMIN &&
      user.type !== UserTypeEnum.VENDOR
    ) {
      return {
        delayedDeliveries: [],
        negativeReviewStores: [],
        stockAlerts: [],
      };
    }

    const vendorIds =
      user.type === UserTypeEnum.VENDOR ? vendorStoreObjectIds(user) : null;

    if (user.type === UserTypeEnum.VENDOR && !vendorIds?.length) {
      return {
        delayedDeliveries: [],
        negativeReviewStores: [],
        stockAlerts: [],
      };
    }

    const [delayedDeliveries, negativeReviewStores, stockAlerts] =
      await Promise.all([
        this.getDelayedDeliveries(vendorIds),
        this.getNegativeReviewStores(vendorIds),
        this.getStockAlerts(vendorIds),
      ]);

    return { delayedDeliveries, negativeReviewStores, stockAlerts };
  }

  /**
   * KPIs agrégés plateforme — réservé aux administrateurs.
   * Fenêtres calendaires en **UTC** (minuit UTC → minuit UTC).
   */
  async getAdminKpis(user: UserModel): Promise<AdminDashboardKpis> {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }

    const now = new Date();
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const todayEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    const yesterdayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1),
    );
    const yesterdayEnd = todayStart;

    const [
      revenueToday,
      revenueYesterday,
      ordersToday,
      ordersYesterday,
      ordersInProgress,
      newClientsToday,
      newClientsYesterday,
      avgDelToday,
      avgDelYesterday,
    ] = await Promise.all([
      this.sumRevenueFcfa(todayStart, todayEnd),
      this.sumRevenueFcfa(yesterdayStart, yesterdayEnd),
      this.orderModel.countDocuments({
        createdAt: { $gte: todayStart, $lt: todayEnd },
      }),
      this.orderModel.countDocuments({
        createdAt: { $gte: yesterdayStart, $lt: yesterdayEnd },
      }),
      this.orderModel.countDocuments({
        status: { $in: ORDER_STATUSES_IN_FLIGHT },
      }),
      this.userModel.countDocuments({
        type: UserTypeEnum.USER,
        createdAt: { $gte: todayStart, $lt: todayEnd },
      }),
      this.userModel.countDocuments({
        type: UserTypeEnum.USER,
        createdAt: { $gte: yesterdayStart, $lt: yesterdayEnd },
      }),
      this.avgCompletedDeliveryMinutes(todayStart, todayEnd),
      this.avgCompletedDeliveryMinutes(yesterdayStart, yesterdayEnd),
    ]);

    const deliveryDeltaMinutes =
      avgDelToday != null && avgDelYesterday != null
        ? avgDelToday - avgDelYesterday
        : null;

    return {
      revenueTodayFcfa: revenueToday,
      revenueYesterdayFcfa: revenueYesterday,
      revenueTrendPercent: trendPercent(revenueToday, revenueYesterday),
      ordersToday,
      ordersYesterday,
      ordersTrendPercent: trendPercent(ordersToday, ordersYesterday),
      ordersInProgress,
      newClientsToday,
      newClientsYesterday,
      newClientsTrendPercent: trendPercent(
        newClientsToday,
        newClientsYesterday,
      ),
      avgDeliveryMinutesToday: avgDelToday,
      avgDeliveryMinutesYesterday: avgDelYesterday,
      deliveryDeltaMinutes,
      revenueTargetFcfa: ADMIN_REVENUE_TARGET_FCFA,
      deliveryTargetMinutes: ADMIN_DELIVERY_TARGET_MIN,
    };
  }

  private async sumRevenueFcfa(start: Date, end: Date): Promise<number> {
    const agg = await this.orderModel
      .aggregate<{ total: number }>([
        {
          $match: {
            createdAt: { $gte: start, $lt: end },
            status: { $in: ORDER_STATUSES_FOR_REVENUE },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ['$total_price', 0] } },
          },
        },
      ])
      .exec();
    const v = agg[0]?.total;
    return typeof v === 'number' && !Number.isNaN(v) ? v : 0;
  }

  /**
   * Durée moyenne (minutes) entre création et dernière mise à jour pour les commandes
   * passées en `completed` dans la fenêtre [start, end) (sur `updatedAt`).
   */
  private async avgCompletedDeliveryMinutes(
    start: Date,
    end: Date,
  ): Promise<number | null> {
    const agg = await this.orderModel
      .aggregate<{ avg: number }>([
        {
          $match: {
            status: OrderStatusEnum.COMPLETED,
            updatedAt: { $gte: start, $lt: end },
          },
        },
        {
          $project: {
            minutes: {
              $divide: [{ $subtract: ['$updatedAt', '$createdAt'] }, 60000],
            },
          },
        },
        { $match: { minutes: { $gte: 1, $lte: 24 * 60 } } },
        { $group: { _id: null, avg: { $avg: '$minutes' } } },
      ])
      .exec();
    const v = agg[0]?.avg;
    return typeof v === 'number' && !Number.isNaN(v) ? Math.round(v) : null;
  }

  private async getDelayedDeliveries(
    vendorStoreIds: Types.ObjectId[] | null,
  ): Promise<DelayedDeliveryAlert[]> {
    const inFlight = [
      OrderStatusEnum.CREATED,
      OrderStatusEnum.PAIED,
      OrderStatusEnum.APPROVED,
      OrderStatusEnum.SHIPPED,
    ];
    const filter: Record<string, unknown> = {
      status: { $in: inFlight },
    };
    if (vendorStoreIds?.length) {
      filter.store = { $in: vendorStoreIds };
    }

    const orders = await this.orderModel
      .find(filter)
      .populate('store', 'name')
      .sort({ createdAt: 1 })
      .limit(200)
      .lean()
      .exec();

    const slaMs = DELIVERY_SLA_MINUTES * 60 * 1000;
    const now = Date.now();
    const out: DelayedDeliveryAlert[] = [];

    for (const o of orders) {
      const createdRaw = o.createdAt;
      const createdAt = createdRaw
        ? new Date(createdRaw as Date | string).getTime()
        : now;
      const deadline = createdAt + slaMs;
      if (now <= deadline) continue;
      const st = o.store as { name?: string } | null;
      out.push({
        orderId: String(o._id),
        displayRef: orderDisplayRef(o._id),
        minutesLate: Math.max(1, Math.floor((now - deadline) / 60000)),
        storeName: st?.name ?? null,
      });
    }

    out.sort((a, b) => b.minutesLate - a.minutesLate);
    return out.slice(0, 5);
  }

  private async getNegativeReviewStores(
    vendorStoreIds: Types.ObjectId[] | null,
  ): Promise<NegativeReviewStoreAlert[]> {
    const since = new Date(Date.now() - REVIEW_WINDOW_MINUTES * 60 * 1000);
    const storeFilter: Record<string, unknown> = {
      createdAt: { $gte: since },
      rate: { $lte: NEGATIVE_REVIEW_MAX_RATE },
    };
    if (vendorStoreIds?.length) {
      storeFilter.store = { $in: vendorStoreIds };
    }

    const storeRatings = await this.storeRatingModel
      .find(storeFilter)
      .populate('store', 'name')
      .lean()
      .exec();

    const agg = new Map<
      string,
      { storeId: string; storeName: string; count: number }
    >();

    const allowStore = (sid: string) =>
      !vendorStoreIds?.length ||
      vendorStoreIds.some((id) => id.toString() === sid);

    for (const r of storeRatings) {
      const st = r.store as { _id?: unknown; name?: string } | null;
      if (!st?._id) continue;
      const sid = String(st._id);
      if (!allowStore(sid)) continue;
      const name = st.name || 'Boutique';
      const prev = agg.get(sid);
      if (prev) prev.count += 1;
      else agg.set(sid, { storeId: sid, storeName: name, count: 1 });
    }

    const productRatings = await this.productRatingModel
      .find({
        createdAt: { $gte: since },
        rate: { $lte: NEGATIVE_REVIEW_MAX_RATE },
      })
      .populate({
        path: 'product',
        select: 'store title',
        populate: { path: 'store', select: 'name' },
      })
      .lean()
      .exec();

    for (const r of productRatings) {
      const prod = r.product as {
        store?: { _id?: unknown; name?: string };
      } | null;
      if (!prod?.store?._id) continue;
      const sid = String(prod.store._id);
      if (!allowStore(sid)) continue;
      const name = prod.store.name || 'Boutique';
      const prev = agg.get(sid);
      if (prev) prev.count += 1;
      else agg.set(sid, { storeId: sid, storeName: name, count: 1 });
    }

    return [...agg.values()]
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  private async getStockAlerts(
    vendorStoreIds: Types.ObjectId[] | null,
  ): Promise<StockAlertRow[]> {
    const filter: Record<string, unknown> = {
      $or: [
        { quantite: { $lte: 0 } },
        { statut: StockStatutEnum.ALERTE },
      ],
    };
    if (vendorStoreIds?.length) {
      filter.store = { $in: vendorStoreIds };
    }

    const rows = await this.stockItemModel
      .find(filter)
      .populate('store', 'name')
      .sort({ updatedAt: -1 })
      .limit(5)
      .lean()
      .exec();

    return rows.map((row) => {
      const st = row.store as { _id?: unknown; name?: string } | null;
      return {
        id: String(row._id),
        produit: row.produit,
        quantite: row.quantite,
        storeId: st?._id ? String(st._id) : '',
        storeName: st?.name ?? null,
      };
    });
  }
}
