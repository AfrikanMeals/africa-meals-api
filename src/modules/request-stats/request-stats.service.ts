import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { AdEventModel, AdEventTypeEnum } from '@schemas/ad-event.schema';
import { AdModel } from '@schemas/ad.schema';
import { CartItemModel } from '@schemas/cart_item.schema';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { StoreCouponModel } from '@schemas/store_coupon.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { StoreAccessService } from '../teams/store-access.service';
import { QueryVendorAnalyticsDto } from './dto/query-vendor-analytics.dto';
import { RequestStatsStore } from './request-stats.store';
import { RequestStatsEntry, RequestStatsQuery } from './request-stats.types';
import {
  isRequestStatsEnabled,
  requestStatsMaxEntries,
} from './request-stats.util';

type VendorAnalyticsSummary = {
  pageViews: number;
  itemViews: number;
  ordersTotal: number;
  ordersPaidOrCompleted: number;
  ordersCancelled: number;
  revenueTotal: number;
  abandonedCarts: number;
  abandonedCartItems: number;
  adsImpressions: number;
  adsClicks: number;
  adsCtr: number;
  couponsTotal: number;
  couponsActive: number;
  couponsRedeemedOrders: number;
  couponsUniqueCodesRedeemed: number;
};

type VendorAnalyticsSeriesRow = {
  date: string;
  pageViews: number;
  itemViews: number;
  orders: number;
  revenue: number;
  abandonedCarts: number;
  adsImpressions: number;
  adsClicks: number;
  couponOrders: number;
};

type VendorAnalyticsTopPageRow = {
  route: string;
  views: number;
};

type VendorAnalyticsTopItemRow = {
  label: string;
  orderCount: number;
  quantity: number;
  revenue: number;
};

type VendorAnalyticsTopCouponRow = {
  code: string;
  uses: number;
  revenue: number;
};

const PAGE_VIEW_ROUTE_RE =
  /(\/shop-home|\/stores(?:\/|$)|\/store-menu(?:\/|$)|\/catalog(?:\/|$)|\/categories(?:\/|$)|\/offers(?:\/?$))/i;
const ITEM_VIEW_ROUTE_RE =
  /(\/products\/:id$|\/drinks\/:id$|\/offers\/:id$|\/items\/:id$)/i;

@Injectable()
export class RequestStatsService {
  constructor(
    private readonly store: RequestStatsStore,
    private readonly config: ConfigService,
    private readonly storeAccess: StoreAccessService,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    @InjectModel(OrderModel.name)
    private readonly orderModel: Model<OrderModel>,
    @InjectModel(CartItemModel.name)
    private readonly cartItemModel: Model<CartItemModel>,
    @InjectModel(AdModel.name)
    private readonly adModel: Model<AdModel>,
    @InjectModel(AdEventModel.name)
    private readonly adEventModel: Model<AdEventModel>,
    @InjectModel(StoreCouponModel.name)
    private readonly couponModel: Model<StoreCouponModel>,
  ) {}

  async assertViewer(user: UserModel): Promise<void> {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    await this.storeAccess.assertAdminPermission(user, 'admin.settings');
  }

  isEnabled(): boolean {
    return isRequestStatsEnabled(
      this.config.get<string>('REQUEST_STATS_ENABLED'),
    );
  }

  getMaxEntries(): number {
    return requestStatsMaxEntries(
      this.config.get<string>('REQUEST_STATS_MAX_ENTRIES'),
    );
  }

  async list(user: UserModel, query: RequestStatsQuery) {
    await this.assertViewer(user);
    const all = this.store.query({ ...query, limit: 500 });
    const entries = this.store.query(query);
    return {
      enabled: this.isEnabled(),
      maxEntries: this.getMaxEntries(),
      bufferSize: this.store.size(),
      summary: this.store.summaryFor(all),
      entries,
      source: 'api' as const,
    };
  }

  async clear(user: UserModel) {
    await this.assertViewer(user);
    this.store.clear();
    return { ok: true };
  }

  private toObjectIdList(ids: string[]): Types.ObjectId[] {
    return ids
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
  }

  private parseRange(query: QueryVendorAnalyticsDto): {
    from: Date;
    to: Date;
    rangeDays: number;
  } {
    const now = new Date();
    const requestedDays = Math.max(
      1,
      Math.min(Number(query.rangeDays ?? 30), 365),
    );
    const from = query.from ? new Date(query.from) : new Date(now);
    let to = query.to ? new Date(query.to) : new Date(now);

    if (!query.from) {
      from.setDate(from.getDate() - (requestedDays - 1));
    }
    if (!query.to) {
      to = now;
    }
    if (Number.isNaN(from.getTime()))
      throw new BadRequestException('invalid_from');
    if (Number.isNaN(to.getTime())) throw new BadRequestException('invalid_to');
    if (to.getTime() < from.getTime()) {
      throw new BadRequestException('invalid_date_range');
    }

    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);
    const days =
      Math.floor((to.getTime() - from.getTime()) / (24 * 3600 * 1000)) + 1;
    if (days > 365) {
      throw new BadRequestException('date_range_too_wide');
    }
    return { from, to, rangeDays: days };
  }

  private dateKey(value: Date | string): string {
    const d = value instanceof Date ? value : new Date(value);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private enumerateDates(from: Date, to: Date): string[] {
    const out: string[] = [];
    const cursor = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
    );
    const end = new Date(
      Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()),
    );
    while (cursor.getTime() <= end.getTime()) {
      out.push(this.dateKey(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
  }

  private async resolveAnalyticsScope(
    user: UserModel,
    requestedStoreId?: string,
  ): Promise<{ scopedStoreIds: string[]; selectedStoreId: string | null }> {
    const sid = String(requestedStoreId ?? '').trim();
    if (user.type === UserTypeEnum.ADMIN) {
      try {
        await this.storeAccess.assertAdminPermission(user, 'admin.analytics');
      } catch {
        await this.storeAccess.assertAdminPermission(user, 'admin.reports');
      }
      if (!sid) return { scopedStoreIds: [], selectedStoreId: null };
      const exists = await this.storeModel
        .findById(sid)
        .select('_id')
        .lean()
        .exec();
      if (!exists) throw new BadRequestException('store_not_found');
      return { scopedStoreIds: [sid], selectedStoreId: sid };
    }

    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_or_admin_only');
    }
    const access = await this.storeAccess.resolveStoreAccess(user);
    const allowedStoreIds = access
      .filter((a) => a.isOwner || a.permissions.includes('analytics.view'))
      .map((a) => a.storeId);
    if (!allowedStoreIds.length) {
      throw new ForbiddenException('permission_denied');
    }
    if (sid) {
      if (!allowedStoreIds.includes(sid)) {
        throw new ForbiddenException('permission_denied');
      }
      return { scopedStoreIds: [sid], selectedStoreId: sid };
    }
    return { scopedStoreIds: allowedStoreIds, selectedStoreId: null };
  }

  async vendorAnalytics(user: UserModel, query: QueryVendorAnalyticsDto) {
    const { from, to, rangeDays } = this.parseRange(query);
    const { scopedStoreIds, selectedStoreId } =
      await this.resolveAnalyticsScope(user, query.storeId);
    const scopedStoreObjectIds = this.toObjectIdList(scopedStoreIds);
    const hasStoreScope = scopedStoreObjectIds.length > 0;
    const isScopedByStore =
      selectedStoreId != null || user.type !== UserTypeEnum.ADMIN;

    const inScopeEntry = (entry: RequestStatsEntry): boolean => {
      const atMs = Date.parse(entry.at);
      if (!Number.isFinite(atMs)) return false;
      if (atMs < from.getTime() || atMs > to.getTime()) return false;
      if (!isScopedByStore) return true;
      const entryStoreId = String(entry.storeId ?? '').trim();
      if (!entryStoreId) return false;
      return scopedStoreIds.includes(entryStoreId);
    };

    const statsEntries = this.store
      .snapshot()
      .filter((e) => e.kind === 'http' && e.method.toUpperCase() === 'GET')
      .filter((e) => (e.statusCode == null ? true : e.statusCode < 400))
      .filter(inScopeEntry);
    const pageViews = statsEntries.filter((e) =>
      PAGE_VIEW_ROUTE_RE.test(e.route),
    ).length;
    const itemViews = statsEntries.filter((e) =>
      ITEM_VIEW_ROUTE_RE.test(e.route),
    ).length;
    const topPagesMap = new Map<string, number>();
    for (const e of statsEntries) {
      if (!PAGE_VIEW_ROUTE_RE.test(e.route)) continue;
      const route = String(e.route || '').trim();
      if (!route) continue;
      topPagesMap.set(route, (topPagesMap.get(route) ?? 0) + 1);
    }
    const topPages: VendorAnalyticsTopPageRow[] = [...topPagesMap.entries()]
      .map(([route, views]) => ({ route, views }))
      .sort((a, b) => b.views - a.views || a.route.localeCompare(b.route))
      .slice(0, 10);

    const orderMatch: Record<string, unknown> = {
      createdAt: { $gte: from, $lte: to },
    };
    if (isScopedByStore) {
      orderMatch.store = { $in: scopedStoreObjectIds };
    }

    const [ordersTotal, ordersPaidOrCompleted, ordersCancelled, revenueRows] =
      await Promise.all([
        this.orderModel.countDocuments(orderMatch).exec(),
        this.orderModel
          .countDocuments({
            ...orderMatch,
            status: {
              $in: [
                OrderStatusEnum.PAIED,
                OrderStatusEnum.APPROVED,
                OrderStatusEnum.SHIPPED,
                OrderStatusEnum.COMPLETED,
              ],
            },
          })
          .exec(),
        this.orderModel
          .countDocuments({
            ...orderMatch,
            status: OrderStatusEnum.CANCELLED,
          })
          .exec(),
        this.orderModel
          .aggregate([
            { $match: orderMatch },
            {
              $match: {
                status: {
                  $in: [
                    OrderStatusEnum.PAIED,
                    OrderStatusEnum.APPROVED,
                    OrderStatusEnum.SHIPPED,
                    OrderStatusEnum.COMPLETED,
                  ],
                },
              },
            },
            { $group: { _id: null, revenue: { $sum: '$totalPrice' } } },
          ])
          .exec(),
      ]);
    const revenueTotal = Number(revenueRows?.[0]?.revenue ?? 0);
    const topItemsAgg = (await this.orderModel
      .aggregate([
        { $match: orderMatch },
        {
          $match: {
            status: {
              $in: [
                OrderStatusEnum.PAIED,
                OrderStatusEnum.APPROVED,
                OrderStatusEnum.SHIPPED,
                OrderStatusEnum.COMPLETED,
              ],
            },
          },
        },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.label',
            orderIds: { $addToSet: '$_id' },
            quantity: { $sum: { $ifNull: ['$items.quantity', 0] } },
            revenue: {
              $sum: {
                $multiply: [
                  { $ifNull: ['$items.quantity', 0] },
                  { $ifNull: ['$items.price', 0] },
                ],
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            label: '$_id',
            orderCount: { $size: '$orderIds' },
            quantity: 1,
            revenue: 1,
          },
        },
        { $sort: { quantity: -1, revenue: -1, label: 1 } },
        { $limit: 10 },
      ])
      .exec()) as Array<{
      label: string;
      orderCount: number;
      quantity: number;
      revenue: number;
    }>;
    const topItems: VendorAnalyticsTopItemRow[] = topItemsAgg.map((r) => ({
      label: String(r.label ?? '').trim() || '(sans libellé)',
      orderCount: Number(r.orderCount ?? 0),
      quantity: Number(r.quantity ?? 0),
      revenue: Number(Number(r.revenue ?? 0).toFixed(2)),
    }));

    const cartMatch: Record<string, unknown> = {
      updatedAt: { $gte: from, $lte: to },
    };
    if (isScopedByStore) {
      cartMatch.store = { $in: scopedStoreObjectIds };
    }
    const cartGroups = (await this.cartItemModel
      .aggregate([
        { $match: cartMatch },
        {
          $group: {
            _id: { store: '$store', user: '$user' },
            updatedAtMax: { $max: '$updatedAt' },
            itemsCount: { $sum: '$quantity' },
          },
        },
      ])
      .exec()) as Array<{
      _id: { store: Types.ObjectId; user: Types.ObjectId };
      updatedAtMax: Date;
      itemsCount: number;
    }>;
    const orderPairsRows = (await this.orderModel
      .aggregate([
        { $match: orderMatch },
        { $match: { status: { $ne: OrderStatusEnum.CANCELLED } } },
        { $group: { _id: { store: '$store', user: '$user' } } },
      ])
      .exec()) as Array<{
      _id: { store: Types.ObjectId; user: Types.ObjectId };
    }>;
    const orderedPairs = new Set(
      orderPairsRows.map((r) => `${String(r._id.store)}|${String(r._id.user)}`),
    );
    const abandonedRows = cartGroups.filter((row) => {
      const k = `${String(row._id.store)}|${String(row._id.user)}`;
      if (orderedPairs.has(k)) return false;
      const rowAtMs = new Date(row.updatedAtMax).getTime();
      return Number.isFinite(rowAtMs) && rowAtMs <= to.getTime();
    });
    const abandonedCarts = abandonedRows.length;
    const abandonedCartItems = abandonedRows.reduce(
      (acc, r) => acc + Number(r.itemsCount ?? 0),
      0,
    );

    const adMatch: Record<string, unknown> = {};
    if (isScopedByStore) adMatch.store = { $in: scopedStoreObjectIds };
    const adIds = (
      await this.adModel.find(adMatch).select('_id').lean().exec()
    ).map((r) => r._id as Types.ObjectId);
    const adEventsMatch: Record<string, unknown> = {
      createdAt: { $gte: from, $lte: to },
    };
    if (adIds.length) {
      adEventsMatch.ad = { $in: adIds };
    } else if (isScopedByStore) {
      adEventsMatch.ad = { $in: [] };
    }
    const adAgg = (await this.adEventModel
      .aggregate([
        { $match: adEventsMatch },
        { $group: { _id: '$eventType', count: { $sum: 1 } } },
      ])
      .exec()) as Array<{ _id: AdEventTypeEnum; count: number }>;
    const adsImpressions = Number(
      adAgg.find((r) => r._id === AdEventTypeEnum.IMPRESSION)?.count ?? 0,
    );
    const adsClicks = Number(
      adAgg.find((r) => r._id === AdEventTypeEnum.CLICK)?.count ?? 0,
    );
    const adsCtr =
      adsImpressions > 0
        ? Number(((adsClicks / adsImpressions) * 100).toFixed(2))
        : 0;

    const couponMatch: Record<string, unknown> = {};
    if (isScopedByStore) couponMatch.store = { $in: scopedStoreObjectIds };
    const [couponsTotal, couponsActive, couponOrdersRows] = await Promise.all([
      this.couponModel.countDocuments(couponMatch).exec(),
      this.couponModel
        .countDocuments({
          ...couponMatch,
          enabled: true,
          validFrom: { $lte: to },
          validUntil: { $gte: from },
        })
        .exec(),
      this.orderModel
        .aggregate([
          { $match: orderMatch },
          {
            $match: {
              couponCode: { $exists: true, $ne: '' },
              status: { $ne: OrderStatusEnum.CANCELLED },
            },
          },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              uniqueCodes: { $addToSet: '$couponCode' },
            },
          },
        ])
        .exec(),
    ]);
    const couponsRedeemedOrders = Number(couponOrdersRows?.[0]?.count ?? 0);
    const couponsUniqueCodesRedeemed = Array.isArray(
      couponOrdersRows?.[0]?.uniqueCodes,
    )
      ? couponOrdersRows[0].uniqueCodes.length
      : 0;
    const topCouponsAgg = (await this.orderModel
      .aggregate([
        { $match: orderMatch },
        {
          $match: {
            couponCode: { $exists: true, $ne: '' },
            status: { $ne: OrderStatusEnum.CANCELLED },
          },
        },
        {
          $group: {
            _id: '$couponCode',
            uses: { $sum: 1 },
            revenue: { $sum: '$totalPrice' },
          },
        },
        { $sort: { uses: -1, revenue: -1, _id: 1 } },
        { $limit: 10 },
      ])
      .exec()) as Array<{ _id: string; uses: number; revenue: number }>;
    const topCoupons: VendorAnalyticsTopCouponRow[] = topCouponsAgg.map(
      (r) => ({
        code: String(r._id ?? '').trim(),
        uses: Number(r.uses ?? 0),
        revenue: Number(Number(r.revenue ?? 0).toFixed(2)),
      }),
    );

    const dateKeys = this.enumerateDates(from, to);
    const byDay = new Map<string, VendorAnalyticsSeriesRow>(
      dateKeys.map((d) => [
        d,
        {
          date: d,
          pageViews: 0,
          itemViews: 0,
          orders: 0,
          revenue: 0,
          abandonedCarts: 0,
          adsImpressions: 0,
          adsClicks: 0,
          couponOrders: 0,
        },
      ]),
    );

    for (const e of statsEntries) {
      const d = this.dateKey(e.at);
      const row = byDay.get(d);
      if (!row) continue;
      if (PAGE_VIEW_ROUTE_RE.test(e.route)) row.pageViews += 1;
      if (ITEM_VIEW_ROUTE_RE.test(e.route)) row.itemViews += 1;
    }

    const orderDailyRows = (await this.orderModel
      .aggregate([
        { $match: orderMatch },
        {
          $group: {
            _id: {
              date: {
                $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
              },
            },
            orders: { $sum: 1 },
            revenue: {
              $sum: {
                $cond: [
                  {
                    $in: [
                      '$status',
                      [
                        OrderStatusEnum.PAIED,
                        OrderStatusEnum.APPROVED,
                        OrderStatusEnum.SHIPPED,
                        OrderStatusEnum.COMPLETED,
                      ],
                    ],
                  },
                  '$totalPrice',
                  0,
                ],
              },
            },
            couponOrders: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$couponCode', null] },
                      { $ne: ['$couponCode', ''] },
                      { $ne: ['$status', OrderStatusEnum.CANCELLED] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ])
      .exec()) as Array<{
      _id: { date: string };
      orders: number;
      revenue: number;
      couponOrders: number;
    }>;
    for (const r of orderDailyRows) {
      const row = byDay.get(String(r._id.date));
      if (!row) continue;
      row.orders += Number(r.orders ?? 0);
      row.revenue += Number(r.revenue ?? 0);
      row.couponOrders += Number(r.couponOrders ?? 0);
    }

    const adDailyRows = (await this.adEventModel
      .aggregate([
        { $match: adEventsMatch },
        {
          $group: {
            _id: {
              date: {
                $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
              },
              eventType: '$eventType',
            },
            count: { $sum: 1 },
          },
        },
      ])
      .exec()) as Array<{
      _id: { date: string; eventType: AdEventTypeEnum };
      count: number;
    }>;
    for (const r of adDailyRows) {
      const row = byDay.get(String(r._id.date));
      if (!row) continue;
      if (r._id.eventType === AdEventTypeEnum.IMPRESSION) {
        row.adsImpressions += Number(r.count ?? 0);
      }
      if (r._id.eventType === AdEventTypeEnum.CLICK) {
        row.adsClicks += Number(r.count ?? 0);
      }
    }

    for (const r of abandonedRows) {
      const d = this.dateKey(r.updatedAtMax);
      const row = byDay.get(d);
      if (!row) continue;
      row.abandonedCarts += 1;
    }

    const series = [...byDay.values()];
    const summary: VendorAnalyticsSummary = {
      pageViews,
      itemViews,
      ordersTotal: Number(ordersTotal ?? 0),
      ordersPaidOrCompleted: Number(ordersPaidOrCompleted ?? 0),
      ordersCancelled: Number(ordersCancelled ?? 0),
      revenueTotal: Number(revenueTotal.toFixed(2)),
      abandonedCarts,
      abandonedCartItems,
      adsImpressions,
      adsClicks,
      adsCtr,
      couponsTotal: Number(couponsTotal ?? 0),
      couponsActive: Number(couponsActive ?? 0),
      couponsRedeemedOrders,
      couponsUniqueCodesRedeemed,
    };

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      rangeDays,
      selectedStoreId,
      summary,
      series,
      topPages,
      topItems,
      topCoupons,
    };
  }
}
