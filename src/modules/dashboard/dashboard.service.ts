import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
/** dayjs est en CJS ; sans `esModuleInterop`, `import dayjs from 'dayjs'` vaut `undefined` au runtime. */
import dayjs = require('dayjs');
import utc = require('dayjs/plugin/utc');
import timezone = require('dayjs/plugin/timezone');
import isoWeek = require('dayjs/plugin/isoWeek');
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { ProductModel } from '@schemas/product.schema';
import { ProductRatingModel } from '@schemas/product_rating.schema';
import {
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationStatus,
} from '@schemas/delivery-agent-application.schema';
import { AddressModel } from '@schemas/address.schema';
import { StockItemModel, StockStatutEnum } from '@schemas/stock-item.schema';
import { StoreModel } from '@schemas/store.schema';
import { StoreRatingModel } from '@schemas/store_rating.schema';
import { StripeProcessedCheckoutModel } from '@schemas/stripe-processed-checkout.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { VendorFeedbackModel } from '@schemas/vendor-feedback.schema';
import { Model, Types } from 'mongoose';
import { AdminVendorFeedbacksQueryDto } from './dto/admin-vendor-feedbacks-query.dto';
import { CreateDashboardLivreurDto } from './dto/create-dashboard-livreur.dto';
import { AssignDashboardOrderDto } from './dto/assign-dashboard-order.dto';
import { CreateVendorFeedbackDto } from './dto/create-vendor-feedback.dto';
import {
  coordsFromLngLat,
  lngLatFromPercentCoords,
  randomLngLatInBbox,
  randomLngLatNearPoint,
  randomPercentCoords,
} from './delivery-driver-geo';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { OrderStatusEventsService } from '@modules/orders/order-status-events.service';
import { OrdersService } from '@modules/orders/orders.service';
import { WsOrderNotifyService } from '@modules/ws-notify/ws-order-notify.service';
import { StoreAccessService } from '@modules/teams/store-access.service';
import { OrderStatusChangeSourceEnum } from '@schemas/order-status-event.schema';
import {
  defaultDeliveryCapacity,
  deliveryVehicleLabelFr,
} from '@modules/delivery-agent/delivery-agent-vehicle.util';
import { resolveDashboardLivreurAvatar } from './dashboard-livreur-avatar.util';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);

/** Objectif CA jour (KPI admin) — même unité que `total_price` commandes. */
const ADMIN_REVENUE_TARGET_FCFA = 500_000;
/** Objectif mensuel carte « Chiffre d’affaires » (unité = `total_price`, affiché $ CA côté UI). */
const DASHBOARD_CA_MONTHLY_TARGET_ADMIN = 500_000;
const DASHBOARD_CA_MONTHLY_TARGET_VENDOR = 1_000;
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

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = nums.reduce((a, b) => a + b, 0);
  return s / nums.length;
}

function trendPercentAvg(current: number, previous: number): number | null {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Délai max (minutes) depuis la création avant de considérer la livraison en retard (pas d’ETA en base). */
const DELIVERY_SLA_MINUTES = 45;
/** Note ≤ seuil = avis négatif (échelle 1–5). */
const NEGATIVE_REVIEW_MAX_RATE = 2;
const REVIEW_WINDOW_MINUTES = 60;

/** Rayon autour de chaque boutique pour afficher les livreurs inscrits (compte DELIVERY + position). */
const REGION_DELIVERY_USERS_RADIUS_KM = 75;
const EARTH_RADIUS_KM = 6371;

function haversineKm(
  lon1: number,
  lat1: number,
  lon2: number,
  lat2: number,
): number {
  const r1 = (lat1 * Math.PI) / 180;
  const r2 = (lat2 * Math.PI) / 180;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(r1) * Math.cos(r2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

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

function normalizeCurrencyCode(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const c = raw.trim().toUpperCase();
  return c.length > 0 ? c : undefined;
}

function pushCurrencyAmount(
  map: Map<string, number>,
  currency: string,
  amount: number,
): void {
  const value = Number.isFinite(amount) ? amount : 0;
  if (!currency) return;
  map.set(currency, (map.get(currency) ?? 0) + value);
}

function breakdownFromCurrencyMap(
  map: Map<string, number>,
): Array<{ currency: string; amount: number }> {
  return [...map.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

function singleCurrencyFromBreakdown(
  rows: Array<{ currency: string; amount: number }>,
): string | undefined {
  return rows.length === 1 ? rows[0]?.currency : undefined;
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

/** CA mois en cours vs même période le mois précédent (fuseau Toronto). */
export type DashboardRevenueSummary = {
  revenueMonthToDate: number;
  revenueComparablePriorMonth: number;
  trendPercent: number | null;
  monthlyTarget: number;
  currency?: string;
  revenueByCurrency?: Array<{ currency: string; amount: number }>;
  comparableRevenueByCurrency?: Array<{ currency: string; amount: number }>;
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

export type DashboardProductReviewRow = {
  id: string;
  rate: number;
  comment: string | null;
  createdAt: string;
  user: {
    id: string;
    fullName: string;
    email: string | null;
    profileImage: string | null;
  };
  product: { id: string; title: string };
  store: { id: string; name: string };
};

export type DashboardProductReviewsSummary = {
  averageRating: number | null;
  totalCount: number;
  distribution: { 1: number; 2: number; 3: number; 4: number; 5: number };
  /** Notes ≤ 2 — suivi qualité */
  negativeCount: number;
};

export type DashboardProductReviewByStore = {
  storeId: string;
  storeName: string;
  averageRating: number;
  reviewCount: number;
  /** Moyenne 14 derniers jours vs 14 jours précédents (pourcentage d’écart). */
  trendPercent: number | null;
};

export type DashboardProductReviewsPayload = {
  reviews: DashboardProductReviewRow[];
  summary: DashboardProductReviewsSummary;
  byStore: DashboardProductReviewByStore[];
};

export type DashboardLivreurCommande = {
  id: string;
  client: string;
  adresse: string;
  eta: string;
};

export type DashboardLivreurRow = {
  id: string;
  nom: string;
  /** Emoji ou initiales — jamais une URL. */
  avatar: string;
  /** Photo profil (compte app) pour affichage <img>. */
  profileImageUrl: string | null;
  tel: string;
  statut: 'disponible' | 'en_livraison' | 'hors_ligne';
  zone: string;
  vehicule: 'Moto' | 'Vélo' | 'Voiture';
  immat: string;
  note: number;
  livraisons_jour: number;
  livraisons_total: number;
  temps_moyen: number;
  distance_jour: number;
  revenu_jour: number;
  capacite: number;
  commande_en_cours: DashboardLivreurCommande | null;
  coords: { x: number; y: number };
  longitude: number;
  latitude: number;
  /** Boutique propriétaire (vide pour anciens enregistrements sans boutique). */
  storeId: string;
  storeName: string;
  /** Toujours `user` : compte `users` type DELIVERY. */
  source: 'user';
};

type VendorStorePoint = { storeId: string; lng: number; lat: number };

type PopulatedAddressLean = {
  _id: Types.ObjectId;
  isDefault?: boolean;
  city?: string;
  location?: { coordinates?: number[] };
};

type DeliveryUserLean = {
  _id: Types.ObjectId;
  fullName: string;
  profileImage?: string;
  phoneNumber?: string;
  addresses?: PopulatedAddressLean[];
};

/** Top plats vendeur : volumes de commande + notes `product_ratings`. */
export type DashboardTopPlatRow = {
  productId: string;
  title: string;
  commandes: number;
  note: number | null;
  avisCount: number;
  revenu: number;
};

/**
 * Top plats : volume sur une fenêtre glissante + tendance jour vs veille (quantités lignes).
 * `trend` = commandes aujourd’hui − hier (fuseau Toronto).
 */
export type DashboardTopPlatDailyRow = {
  key: string;
  title: string;
  /** Somme des quantités sur la fenêtre de classement (ex. 90 j). */
  commandesPeriode: number;
  commandesToday: number;
  commandesYesterday: number;
  trend: number;
};

/** Histogramme 0–23 h : activité = créations de commande + livraisons (heure locale Canada). */
export type DashboardPeakHourRow = {
  h: string;
  /** Total barre (commandes + livraisons). */
  cmd: number;
  commandes: number;
  livraisons: number;
};

/** Ligne « Nouveaux clients » : dernière commande + 1ère fois dans cette boutique. */
export type FinanceWeeklyUserPerformanceRow = {
  userId: string;
  fullName: string;
  email: string;
  orderCount: number;
  totalSpent: number;
  avgOrderValue: number;
  shippingTotal: number;
  priorTotalSpent: number;
  trendPercent: number | null;
  currency?: string;
  totalSpentByCurrency?: Array<{ currency: string; amount: number }>;
  priorTotalSpentByCurrency?: Array<{ currency: string; amount: number }>;
};

export type FinanceWeeklyPerformanceSummary = {
  revenueThisWeek: number;
  revenuePriorWeek: number;
  revenueTrendPercent: number | null;
  ordersThisWeek: number;
  ordersPriorWeek: number;
  ordersTrendPercent: number | null;
  activeClientsThisWeek: number;
  activeVendorsThisWeek: number;
  currency?: string;
  revenueByCurrency?: Array<{ currency: string; amount: number }>;
  priorRevenueByCurrency?: Array<{ currency: string; amount: number }>;
};

export type FinanceWeeklyUserPerformancePayload = {
  timezone: string;
  weekStart: string;
  weekEnd: string;
  priorWeekStart: string;
  priorWeekEnd: string;
  summary: FinanceWeeklyPerformanceSummary;
  clients: FinanceWeeklyUserPerformanceRow[];
  vendors: FinanceWeeklyUserPerformanceRow[];
};

export type FinancePeriodReportSummary = {
  totalRevenue: number;
  orderCount: number;
  avgOrderValue: number;
  shippingTotal: number;
  priorPeriodRevenue: number;
  trendPercent: number | null;
  currency?: string;
};

export type FinancePeriodDailyPoint = {
  date: string;
  revenue: number;
  orderCount: number;
  currency?: string;
};

export type FinancePeriodReportOrderRow = {
  id: string;
  orderNumber: string;
  createdAt: string;
  customerName: string;
  customerEmail: string;
  totalPrice: number;
  shippingPrice: number;
  status: string;
  storeName: string | null;
  stripeProcessingFeeCents: number;
  currency: string;
};

export type FinancePeriodReportPayload = {
  timezone: string;
  from: string;
  to: string;
  priorFrom: string;
  priorTo: string;
  summary: FinancePeriodReportSummary;
  daily: FinancePeriodDailyPoint[];
  orders: FinancePeriodReportOrderRow[];
};

export type DashboardVendorRecentCustomerRow = {
  userId: string;
  fullName: string;
  profileImage: string | null;
  lastOrderAt: string;
  isFirstOrderAtStore: boolean;
};

export type DashboardRecentCustomersPayload = {
  newCustomersToday: number;
  clients: DashboardVendorRecentCustomerRow[];
};

export type DashboardRevenueSeriesPoint = {
  label: string;
  date: string;
  valeur: number;
};

export type DashboardRevenueSeriesPayload = {
  period: '7d' | '30d' | '12m';
  timezone: string;
  total: number;
  points: DashboardRevenueSeriesPoint[];
};

export type DashboardTopStoreRow = {
  storeId: string;
  name: string;
  revenue: number;
  commandes: number;
  note: number | null;
};

/** Heure locale pour l’histogramme (Canada — aligné sur l’usage principal du dashboard). */
const PEAK_HOURS_TZ = 'America/Toronto';
/** Fenêtre pour classer le top plats (évite une liste vide si peu de ventes sur 48 h). */
const TOP_PLATS_RANKING_LOOKBACK_DAYS = 365;
/** Fenêtre glissante : seules les commandes touchées dans cette période sont agrégées (les jours plus anciens « tombent » du calcul). */
const PEAK_HOURS_LOOKBACK_DAYS = 30;

function emptyPeakHourSlots(): DashboardPeakHourRow[] {
  return Array.from({ length: 24 }, (_, i) => ({
    h: `${i}h`,
    cmd: 0,
    commandes: 0,
    livraisons: 0,
  }));
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @InjectModel(OrderModel.name)
    private readonly orderModel: Model<OrderModel>,
    @InjectModel(ProductModel.name)
    private readonly productModel: Model<ProductModel>,
    @InjectModel(StoreRatingModel.name)
    private readonly storeRatingModel: Model<StoreRatingModel>,
    @InjectModel(ProductRatingModel.name)
    private readonly productRatingModel: Model<ProductRatingModel>,
    @InjectModel(StockItemModel.name)
    private readonly stockItemModel: Model<StockItemModel>,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    @InjectModel(AddressModel.name)
    private readonly addressModel: Model<AddressModel>,
    @InjectModel(DeliveryAgentApplicationModel.name)
    private readonly deliveryAgentApplicationModel: Model<DeliveryAgentApplicationModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    @InjectModel(StripeProcessedCheckoutModel.name)
    private readonly stripeProcessedCheckoutModel: Model<StripeProcessedCheckoutModel>,
    @InjectModel(VendorFeedbackModel.name)
    private readonly vendorFeedbackModel: Model<VendorFeedbackModel>,
    private readonly notificationsService: NotificationsService,
    private readonly orderStatusEvents: OrderStatusEventsService,
    @Inject(OrdersService)
    private readonly ordersService: OrdersService,
    @Inject(WsOrderNotifyService)
    private readonly wsOrderNotify: WsOrderNotifyService,
    private readonly storeAccess: StoreAccessService,
  ) {}

  async getAlerts(user: UserModel): Promise<{
    delayedDeliveries: DelayedDeliveryAlert[];
    negativeReviewStores: NegativeReviewStoreAlert[];
    stockAlerts: StockAlertRow[];
  }> {
    if (user.type !== UserTypeEnum.ADMIN && user.type !== UserTypeEnum.VENDOR) {
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

  private customerUserIdForOrderPush(order: { user?: unknown }): string | null {
    const u = order.user;
    if (!u) {
      return null;
    }
    if (u instanceof Types.ObjectId) {
      return u.toHexString();
    }
    if (typeof u === 'object' && u !== null && '_id' in u) {
      const id = (u as { _id: unknown })._id;
      if (id instanceof Types.ObjectId) {
        return id.toHexString();
      }
      if (id != null && Types.ObjectId.isValid(String(id))) {
        return String(id);
      }
    }
    return null;
  }

  private storeNameForOrderPush(order: {
    store?: unknown;
  }): string | undefined {
    const s = order.store;
    if (s && typeof s === 'object' && s !== null && 'name' in s) {
      const n = String((s as { name?: string }).name ?? '').trim();
      return n || undefined;
    }
    return undefined;
  }

  private storeOwnerUserIdForOrderPush(order: {
    store?: unknown;
  }): string | null {
    const s = order.store;
    if (!s || typeof s !== 'object' || s === null || !('owner' in s)) {
      return null;
    }
    const o = (s as { owner?: unknown }).owner;
    if (o instanceof Types.ObjectId) {
      return o.toHexString();
    }
    if (o && typeof o === 'object' && '_id' in o) {
      const id = (o as { _id: unknown })._id;
      if (id instanceof Types.ObjectId) {
        return id.toHexString();
      }
      if (id != null && Types.ObjectId.isValid(String(id))) {
        return String(id);
      }
    }
    return null;
  }

  /**
   * Heures d’activité (0–23 h, fuseau `America/Toronto`, **30 derniers jours** glissants) :
   * - **commandes** : heure de `createdAt` (hors annulées)
   * - **livraisons** : heure de `updatedAt` pour statuts expédié / livré
   * La courbe affiche la somme des deux (`cmd`).
   */
  async listPeakHoursActivity(
    user: UserModel,
  ): Promise<DashboardPeakHourRow[]> {
    if (user.type !== UserTypeEnum.VENDOR && user.type !== UserTypeEnum.ADMIN) {
      return emptyPeakHourSlots();
    }

    const storeIds =
      user.type === UserTypeEnum.VENDOR ? vendorStoreObjectIds(user) : null;
    if (user.type === UserTypeEnum.VENDOR && !storeIds?.length) {
      return emptyPeakHourSlots();
    }

    const since = new Date(
      Date.now() - PEAK_HOURS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );
    const baseMatch: Record<string, unknown> = {
      status: { $ne: OrderStatusEnum.CANCELLED },
      $or: [{ createdAt: { $gte: since } }, { updatedAt: { $gte: since } }],
    };
    if (storeIds?.length) {
      baseMatch['store'] = { $in: storeIds };
    }

    type FacetRow = { _id: number | null; n: number };
    type FacetOut = { crea: FacetRow[]; liv: FacetRow[] };

    let facet: FacetOut;
    try {
      const agg = await this.orderModel
        .aggregate<FacetOut>([
          { $match: baseMatch },
          {
            $facet: {
              crea: [
                {
                  $project: {
                    hour: {
                      $hour: { date: '$createdAt', timezone: PEAK_HOURS_TZ },
                    },
                  },
                },
                { $group: { _id: '$hour', n: { $sum: 1 } } },
              ],
              liv: [
                {
                  $match: {
                    status: {
                      $in: [OrderStatusEnum.SHIPPED, OrderStatusEnum.COMPLETED],
                    },
                  },
                },
                {
                  $project: {
                    hour: {
                      $hour: { date: '$updatedAt', timezone: PEAK_HOURS_TZ },
                    },
                  },
                },
                { $group: { _id: '$hour', n: { $sum: 1 } } },
              ],
            },
          },
        ])
        .exec();
      facet = agg[0] ?? { crea: [], liv: [] };
    } catch {
      const aggUtc = await this.orderModel
        .aggregate<FacetOut>([
          { $match: baseMatch },
          {
            $facet: {
              crea: [
                { $project: { hour: { $hour: '$createdAt' } } },
                { $group: { _id: '$hour', n: { $sum: 1 } } },
              ],
              liv: [
                {
                  $match: {
                    status: {
                      $in: [OrderStatusEnum.SHIPPED, OrderStatusEnum.COMPLETED],
                    },
                  },
                },
                { $project: { hour: { $hour: '$updatedAt' } } },
                { $group: { _id: '$hour', n: { $sum: 1 } } },
              ],
            },
          },
        ])
        .exec();
      facet = aggUtc[0] ?? { crea: [], liv: [] };
    }

    const slots = emptyPeakHourSlots();
    for (const row of facet.crea) {
      const h = row._id;
      if (typeof h !== 'number' || h < 0 || h > 23) continue;
      slots[h].commandes = Number(row.n) || 0;
    }
    for (const row of facet.liv) {
      const h = row._id;
      if (typeof h !== 'number' || h < 0 || h > 23) continue;
      slots[h].livraisons = Number(row.n) || 0;
    }
    for (const s of slots) {
      s.cmd = s.commandes + s.livraisons;
    }
    return slots;
  }

  /**
   * Plats les plus commandés (lignes `orders.items` dont le libellé = titre produit)
   * et mieux notés (`product_ratings`), pour les boutiques du vendeur.
   */
  async listVendorTopPlats(user: UserModel): Promise<DashboardTopPlatRow[]> {
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_only');
    }
    const storeIds = vendorStoreObjectIds(user);
    if (!storeIds.length) return [];

    const products = await this.productModel
      .find({ store: { $in: storeIds } })
      .select('_id title price')
      .lean()
      .exec();

    if (!products.length) return [];

    const titleLcToProductId = new Map<string, Types.ObjectId>();
    const productById = new Map<string, { title: string; price: number }>();
    for (const p of products) {
      const id = String(p._id);
      const title = String(p.title ?? '').trim();
      const lc = title.toLowerCase();
      if (!lc) continue;
      if (!titleLcToProductId.has(lc)) {
        titleLcToProductId.set(lc, p._id as Types.ObjectId);
      }
      productById.set(id, {
        title,
        price: Number(p.price) || 0,
      });
    }

    const orders = await this.orderModel
      .find({
        store: { $in: storeIds },
        status: { $ne: OrderStatusEnum.CANCELLED },
      })
      .select('items')
      .lean()
      .exec();

    const byProduct = new Map<string, { commandes: number; revenu: number }>();
    for (const ord of orders) {
      const items =
        (
          ord as {
            items?: Array<{
              label?: string;
              quantity?: number;
              price?: number;
            }>;
          }
        ).items ?? [];
      for (const it of items) {
        const lc = String(it.label ?? '')
          .trim()
          .toLowerCase();
        if (!lc) continue;
        const pidObj = titleLcToProductId.get(lc);
        if (!pidObj) continue;
        const pid = String(pidObj);
        const q =
          typeof it.quantity === 'number' && it.quantity > 0 ? it.quantity : 1;
        const line = (Number(it.price) || 0) * q;
        const cur = byProduct.get(pid) ?? { commandes: 0, revenu: 0 };
        cur.commandes += q;
        cur.revenu += line;
        byProduct.set(pid, cur);
      }
    }

    const productObjectIds = products.map((p) => p._id as Types.ObjectId);
    type RatingAgg = {
      _id: Types.ObjectId;
      avgRate: number;
      ratingCount: number;
    };
    const ratingAgg = (await this.productRatingModel
      .aggregate<RatingAgg>([
        { $match: { product: { $in: productObjectIds } } },
        {
          $group: {
            _id: '$product',
            avgRate: { $avg: '$rate' },
            ratingCount: { $sum: 1 },
          },
        },
      ])
      .exec()) as RatingAgg[];

    const ratingByProduct = new Map<string, { avg: number; count: number }>();
    for (const r of ratingAgg) {
      if (!r._id) continue;
      ratingByProduct.set(String(r._id), {
        avg: Number(r.avgRate),
        count: Number(r.ratingCount) || 0,
      });
    }

    const rows: DashboardTopPlatRow[] = [];
    for (const p of products) {
      const pid = String(p._id);
      const meta = productById.get(pid);
      if (!meta) continue;
      const ord = byProduct.get(pid);
      const rat = ratingByProduct.get(pid);
      const commandes = ord?.commandes ?? 0;
      const revenu = ord?.revenu ?? 0;
      const avisCount = rat?.count ?? 0;
      const note =
        avisCount > 0 && rat && Number.isFinite(rat.avg)
          ? Math.round(rat.avg * 10) / 10
          : null;
      if (commandes === 0 && avisCount === 0) continue;
      rows.push({
        productId: pid,
        title: meta.title,
        commandes,
        note,
        avisCount,
        revenu,
      });
    }

    rows.sort((a, b) => {
      if (b.commandes !== a.commandes) return b.commandes - a.commandes;
      const na = a.note ?? 0;
      const nb = b.note ?? 0;
      if (nb !== na) return nb - na;
      return b.avisCount - a.avisCount;
    });

    return rows.slice(0, 6);
  }

  /**
   * Top 5 plats les plus commandés sur **les ~12 derniers mois** (`TOP_PLATS_RANKING_LOOKBACK_DAYS`, Toronto),
   * avec tendance **aujourd’hui vs hier** (somme des quantités sur les lignes).
   * Vendeur : libellés alignés sur le catalogue de ses boutiques. Admin : toute la plateforme.
   */
  async listDashboardTopPlatsDaily(
    user: UserModel,
  ): Promise<DashboardTopPlatDailyRow[]> {
    if (user.type !== UserTypeEnum.VENDOR && user.type !== UserTypeEnum.ADMIN) {
      return [];
    }

    const z = PEAK_HOURS_TZ;
    const startToday = dayjs().tz(z).startOf('day').toDate();
    const endToday = dayjs().tz(z).endOf('day').toDate();
    const startYesterday = dayjs()
      .tz(z)
      .subtract(1, 'day')
      .startOf('day')
      .toDate();
    const endYesterday = dayjs().tz(z).subtract(1, 'day').endOf('day').toDate();
    const startRanking = dayjs()
      .tz(z)
      .subtract(TOP_PLATS_RANKING_LOOKBACK_DAYS, 'day')
      .startOf('day')
      .toDate();

    let allowedLc: Set<string> | null = null;
    let storeFilter: Types.ObjectId[] | null = null;

    if (user.type === UserTypeEnum.VENDOR) {
      const storeIds = vendorStoreObjectIds(user);
      if (!storeIds.length) return [];
      storeFilter = storeIds;
      const products = await this.productModel
        .find({ store: { $in: storeIds } })
        .select('title')
        .lean()
        .exec();
      allowedLc = new Set<string>();
      for (const p of products) {
        const lc = String(p.title ?? '')
          .trim()
          .toLowerCase();
        if (lc) allowedLc.add(lc);
      }
      if (!allowedLc.size) return [];
    }

    const match: Record<string, unknown> = {
      status: { $ne: OrderStatusEnum.CANCELLED },
      createdAt: { $gte: startRanking, $lte: endToday },
    };
    if (storeFilter?.length) {
      match.store = { $in: storeFilter };
    }

    type OrderLean = {
      items?: Array<{ label?: string; quantity?: number }>;
      createdAt?: Date;
    };
    const orders = (await this.orderModel
      .find(match)
      .select('items createdAt')
      .lean()
      .exec()) as OrderLean[];

    type Agg = { title: string; n: number };
    const periodMap = new Map<string, Agg>();
    const todayMap = new Map<string, Agg>();
    const yestMap = new Map<string, Agg>();

    const startT = startToday.getTime();
    const endT = endToday.getTime();
    const startY = startYesterday.getTime();
    const endY = endYesterday.getTime();

    const bump = (
      map: Map<string, Agg>,
      lc: string,
      raw: string,
      q: number,
    ) => {
      const prev = map.get(lc);
      if (!prev) {
        map.set(lc, { title: raw || lc, n: q });
      } else {
        prev.n += q;
        map.set(lc, prev);
      }
    };

    for (const ord of orders) {
      const ca = ord.createdAt ? new Date(ord.createdAt).getTime() : NaN;
      const inToday = ca >= startT && ca <= endT;
      const inYesterday = ca >= startY && ca <= endY;

      for (const it of ord.items ?? []) {
        const raw = String(it.label ?? '').trim();
        const lc = raw.toLowerCase();
        if (!lc) continue;
        if (allowedLc && !allowedLc.has(lc)) continue;

        const q =
          typeof it.quantity === 'number' && it.quantity > 0 ? it.quantity : 1;

        bump(periodMap, lc, raw, q);
        if (inToday) bump(todayMap, lc, raw, q);
        if (inYesterday) bump(yestMap, lc, raw, q);
      }
    }

    const ranked = [...periodMap.entries()]
      .map(([lc, v]) => ({ lc, title: v.title, n: v.n }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n)
      .slice(0, 5);

    const rows: DashboardTopPlatDailyRow[] = [];
    for (const { lc, title, n } of ranked) {
      const t = todayMap.get(lc)?.n ?? 0;
      const y = yestMap.get(lc)?.n ?? 0;
      rows.push({
        key: lc,
        title,
        commandesPeriode: n,
        commandesToday: t,
        commandesYesterday: y,
        trend: t - y,
      });
    }

    return rows;
  }

  /**
   * Trois derniers clients distincts (dernière commande la plus récente par personne)
   * et total des **nouveaux** clients du jour : première commande non annulée dans **cette** boutique
   * (jour calendaire `America/Toronto`).
   */
  async listVendorRecentCustomers(user: UserModel): Promise<{
    newCustomersToday: number;
    clients: DashboardVendorRecentCustomerRow[];
  }> {
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_only');
    }
    const storeIds = vendorStoreObjectIds(user);
    if (!storeIds.length) {
      return { newCustomersToday: 0, clients: [] };
    }

    const start = dayjs().tz(PEAK_HOURS_TZ).startOf('day').toDate();
    const end = dayjs().tz(PEAK_HOURS_TZ).endOf('day').toDate();
    const orderColl = this.orderModel.collection.name;

    type CountAgg = { n?: number };
    const newTodayAgg = await this.orderModel
      .aggregate<CountAgg>([
        {
          $match: {
            store: { $in: storeIds },
            status: { $ne: OrderStatusEnum.CANCELLED },
            createdAt: { $gte: start, $lte: end },
          },
        },
        {
          $lookup: {
            from: orderColl,
            let: {
              uid: '$user',
              sid: '$store',
              ca: '$createdAt',
            },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$user', '$$uid'] },
                      { $eq: ['$store', '$$sid'] },
                      { $ne: ['$status', OrderStatusEnum.CANCELLED] },
                      { $lt: ['$createdAt', '$$ca'] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: 'prior',
          },
        },
        { $match: { prior: { $size: 0 } } },
        { $group: { _id: '$user' } },
        { $count: 'n' },
      ])
      .exec();
    const newCustomersToday = Number(newTodayAgg[0]?.n) || 0;

    type PopUser = {
      _id: Types.ObjectId;
      fullName?: string;
      profileImage?: string;
    };
    type OrderRecentLean = {
      _id: Types.ObjectId;
      user: Types.ObjectId | PopUser;
      store: Types.ObjectId;
      createdAt: Date;
    };

    const recentOrders = (await this.orderModel
      .find({
        store: { $in: storeIds },
        status: { $ne: OrderStatusEnum.CANCELLED },
      })
      .sort({ createdAt: -1 })
      .limit(60)
      .populate('user', 'fullName profileImage')
      .lean()
      .exec()) as unknown as OrderRecentLean[];

    const seenUser = new Set<string>();
    const picked: OrderRecentLean[] = [];
    for (const o of recentOrders) {
      const uid =
        typeof o.user === 'object' &&
        o.user !== null &&
        '_id' in o.user &&
        !(o.user instanceof Types.ObjectId)
          ? String((o.user as PopUser)._id)
          : String(o.user);
      if (seenUser.has(uid)) continue;
      seenUser.add(uid);
      picked.push(o);
      if (picked.length >= 3) break;
    }

    const clients: DashboardVendorRecentCustomerRow[] = [];
    for (const o of picked) {
      const pop =
        typeof o.user === 'object' &&
        o.user !== null &&
        '_id' in o.user &&
        !(o.user instanceof Types.ObjectId)
          ? (o.user as PopUser)
          : null;
      if (!pop?._id) continue;

      const priorCount = await this.orderModel.countDocuments({
        store: o.store,
        user: pop._id,
        status: { $ne: OrderStatusEnum.CANCELLED },
        createdAt: { $lt: o.createdAt },
      });

      const img = String(pop.profileImage ?? '').trim();
      clients.push({
        userId: String(pop._id),
        fullName: String(pop.fullName ?? '').trim() || 'Client',
        profileImage: img.length ? img : null,
        lastOrderAt: o.createdAt.toISOString(),
        isFirstOrderAtStore: priorCount === 0,
      });
    }

    return { newCustomersToday, clients };
  }

  /**
   * Totaux commandes + répartition (livrées / en livraison / en attente / annulées).
   * Admin = plateforme, vendeur = ses boutiques, client = ses commandes ; autres rôles → zéros.
   */
  async getDashboardOrderStatusSummary(user: UserModel): Promise<{
    total: number;
    livrees: number;
    enLivraison: number;
    enAttente: number;
    payees: number;
    annulees: number;
  }> {
    const empty = {
      total: 0,
      livrees: 0,
      enLivraison: 0,
      enAttente: 0,
      payees: 0,
      annulees: 0,
    };

    const baseMatch: Record<string, unknown> = {};

    if (user.type === UserTypeEnum.ADMIN) {
      // toutes les commandes
    } else if (user.type === UserTypeEnum.VENDOR) {
      const storeIds = vendorStoreObjectIds(user);
      if (!storeIds.length) return empty;
      baseMatch.store = { $in: storeIds };
    } else if (user.type === UserTypeEnum.USER) {
      const rawId =
        (user as UserModel & { _id?: Types.ObjectId | string })._id ?? user.id;
      if (rawId == null || rawId === '') return empty;
      baseMatch.user =
        rawId instanceof Types.ObjectId
          ? rawId
          : new Types.ObjectId(String(rawId));
    } else {
      return empty;
    }

    type StatusAgg = { _id: OrderStatusEnum; n: number };
    const rows = await this.orderModel
      .aggregate<StatusAgg>([
        { $match: baseMatch },
        { $group: { _id: '$status', n: { $sum: 1 } } },
      ])
      .exec();

    let livrees = 0;
    let enLivraison = 0;
    let enAttente = 0;
    let payees = 0;
    let annulees = 0;
    for (const row of rows) {
      const n = Number(row.n) || 0;
      switch (row._id) {
        case OrderStatusEnum.COMPLETED:
          livrees += n;
          break;
        case OrderStatusEnum.SHIPPED:
          enLivraison += n;
          break;
        case OrderStatusEnum.CANCELLED:
          annulees += n;
          break;
        case OrderStatusEnum.CREATED:
          enAttente += n;
          break;
        case OrderStatusEnum.PAIED:
        case OrderStatusEnum.APPROVED:
          payees += n;
          break;
        default:
          enAttente += n;
      }
    }

    const total = livrees + enLivraison + enAttente + payees + annulees;
    return { total, livrees, enLivraison, enAttente, payees, annulees };
  }

  /**
   * Avis sur les plats (collection `product_ratings`) : client auteur, plat, restaurant (boutique du plat).
   * Vendeur : uniquement les avis dont le plat appartient à l’une de ses boutiques.
   */
  async getProductReviewsDashboard(
    user: UserModel,
  ): Promise<DashboardProductReviewsPayload> {
    if (user.type !== UserTypeEnum.ADMIN && user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('dashboard_reviews_access_denied');
    }

    const vendorIds =
      user.type === UserTypeEnum.VENDOR ? vendorStoreObjectIds(user) : null;

    if (user.type === UserTypeEnum.VENDOR && !vendorIds?.length) {
      return {
        reviews: [],
        summary: {
          averageRating: null,
          totalCount: 0,
          distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
          negativeCount: 0,
        },
        byStore: [],
      };
    }

    const WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    const raw = await this.productRatingModel
      .find({})
      .populate({
        path: 'user',
        select: 'fullName email profileImage',
      })
      .populate({
        path: 'product',
        select: 'title store',
        populate: { path: 'store', select: 'name' },
      })
      .sort({ createdAt: -1 })
      .limit(2000)
      .lean()
      .exec();

    type LeanUser = {
      _id?: unknown;
      fullName?: string;
      email?: string;
      profileImage?: string;
    };
    type LeanStore = { _id?: unknown; name?: string };
    type LeanProduct = {
      _id?: unknown;
      title?: string;
      store?: LeanStore | null;
    };

    const allowStore = (storeId: string) =>
      !vendorIds?.length || vendorIds.some((id) => id.toString() === storeId);

    const reviews: DashboardProductReviewRow[] = [];
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let negativeCount = 0;

    const storeAcc = new Map<
      string,
      {
        storeName: string;
        all: number[];
        currentWindow: number[];
        previousWindow: number[];
      }
    >();

    for (const r of raw) {
      const prod = r.product as LeanProduct | null;
      const usr = r.user as LeanUser | null;
      if (!prod?._id || !prod.store?._id || !usr?._id) continue;

      const storeId = String(prod.store._id);
      if (!allowStore(storeId)) continue;

      const rawRate = Number(r.rate);
      if (!Number.isFinite(rawRate)) continue;
      const rate = Math.min(5, Math.max(1, Math.round(rawRate)));

      distribution[rate as 1 | 2 | 3 | 4 | 5] += 1;
      if (rate <= 2) negativeCount += 1;

      const createdMs = r.createdAt
        ? new Date(r.createdAt as Date | string).getTime()
        : now;
      const storeName = prod.store.name?.trim() || 'Restaurant';

      if (!storeAcc.has(storeId)) {
        storeAcc.set(storeId, {
          storeName,
          all: [],
          currentWindow: [],
          previousWindow: [],
        });
      }
      const acc = storeAcc.get(storeId)!;
      acc.all.push(rate);
      if (createdMs >= now - WINDOW_MS) {
        acc.currentWindow.push(rate);
      } else if (createdMs >= now - 2 * WINDOW_MS) {
        acc.previousWindow.push(rate);
      }

      reviews.push({
        id: String(r._id),
        rate,
        comment:
          typeof r.comment === 'string' && r.comment.trim()
            ? r.comment.trim()
            : null,
        createdAt: (r.createdAt
          ? new Date(r.createdAt as Date | string).toISOString()
          : new Date().toISOString()) as string,
        user: {
          id: String(usr._id),
          fullName: usr.fullName?.trim() || 'Client',
          email: usr.email?.trim() || null,
          profileImage: usr.profileImage?.trim() || null,
        },
        product: {
          id: String(prod._id),
          title: prod.title?.trim() || 'Plat',
        },
        store: { id: storeId, name: storeName },
      });
    }

    const totalCount = reviews.length;
    const averageRating =
      totalCount > 0
        ? Math.round(
            (reviews.reduce((a, x) => a + x.rate, 0) / totalCount) * 10,
          ) / 10
        : null;

    const byStore: DashboardProductReviewByStore[] = [...storeAcc.entries()]
      .map(([storeId, acc]) => {
        const reviewCount = acc.all.length;
        const averageRatingStore =
          reviewCount > 0
            ? Math.round(
                (acc.all.reduce((a, b) => a + b, 0) / reviewCount) * 10,
              ) / 10
            : 0;
        const cur = avg(acc.currentWindow);
        const prev = avg(acc.previousWindow);
        const trendPercent =
          cur != null && prev != null ? trendPercentAvg(cur, prev) : null;
        return {
          storeId,
          storeName: acc.storeName,
          averageRating: averageRatingStore,
          reviewCount,
          trendPercent,
        };
      })
      .sort((a, b) => b.reviewCount - a.reviewCount)
      .slice(0, 20);

    return {
      reviews,
      summary: {
        averageRating,
        totalCount,
        distribution,
        negativeCount,
      },
      byStore,
    };
  }

  async submitVendorFeedback(
    user: UserModel,
    body: CreateVendorFeedbackDto,
  ): Promise<{
    id: string;
    rate: number;
    comment: string | null;
    createdAt: string;
  }> {
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_feedback_vendor_only');
    }

    const commentRaw =
      typeof body.comment === 'string' ? body.comment.trim() : '';
    const comment = commentRaw.length ? commentRaw : undefined;
    const rate = Math.min(5, Math.max(1, Math.round(Number(body.rate) || 0)));

    const created = await this.vendorFeedbackModel.create({
      user: user._id,
      rate,
      ...(comment ? { comment } : {}),
    });

    return {
      id: String(created._id),
      rate: Number(created.rate) || rate,
      comment:
        typeof created.comment === 'string' && created.comment.trim()
          ? created.comment.trim()
          : null,
      createdAt:
        created.createdAt instanceof Date
          ? created.createdAt.toISOString()
          : new Date().toISOString(),
    };
  }

  async listVendorFeedbacksAdmin(
    user: UserModel,
    query: AdminVendorFeedbacksQueryDto,
  ): Promise<{
    items: Array<{
      id: string;
      rate: number;
      comment: string | null;
      createdAt: string;
      vendor: {
        id: string;
        fullName: string;
        email: string | null;
        profileImage: string | null;
      };
    }>;
    total: number;
    page: number;
    take: number;
    hasMore: boolean;
    filters: {
      minRate: number | null;
      maxRate: number | null;
      from: string | null;
      to: string | null;
    };
  }> {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('vendor_feedback_admin_only');
    }

    const page = Math.max(1, Number(query.page) || 1);
    const take = Math.min(100, Math.max(1, Number(query.take) || 20));
    const minRateRaw =
      query.minRate != null ? Math.round(Number(query.minRate)) : null;
    const maxRateRaw =
      query.maxRate != null ? Math.round(Number(query.maxRate)) : null;
    const minRate =
      minRateRaw != null ? Math.min(5, Math.max(1, minRateRaw)) : null;
    const maxRate =
      maxRateRaw != null ? Math.min(5, Math.max(1, maxRateRaw)) : null;
    if (minRate != null && maxRate != null && minRate > maxRate) {
      throw new BadRequestException('vendor_feedback_invalid_rate_range');
    }

    const fromRaw = typeof query.from === 'string' ? query.from.trim() : '';
    const toRaw = typeof query.to === 'string' ? query.to.trim() : '';
    const fromDate = fromRaw ? new Date(fromRaw) : null;
    const toDate = toRaw ? new Date(toRaw) : null;
    if (fromDate && Number.isNaN(fromDate.getTime())) {
      throw new BadRequestException('vendor_feedback_invalid_from');
    }
    if (toDate && Number.isNaN(toDate.getTime())) {
      throw new BadRequestException('vendor_feedback_invalid_to');
    }
    if (toDate) {
      toDate.setHours(23, 59, 59, 999);
    }
    if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
      throw new BadRequestException('vendor_feedback_invalid_date_range');
    }

    const where: Record<string, unknown> = {};
    if (minRate != null || maxRate != null) {
      const rateWhere: Record<string, number> = {};
      if (minRate != null) rateWhere.$gte = minRate;
      if (maxRate != null) rateWhere.$lte = maxRate;
      where.rate = rateWhere;
    }
    if (fromDate || toDate) {
      const createdAtWhere: Record<string, Date> = {};
      if (fromDate) createdAtWhere.$gte = fromDate;
      if (toDate) createdAtWhere.$lte = toDate;
      where.createdAt = createdAtWhere;
    }

    const skip = (page - 1) * take;
    const [rows, total] = await Promise.all([
      this.vendorFeedbackModel
        .find(where)
        .populate({ path: 'user', select: 'fullName email profileImage' })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(take)
        .lean()
        .exec(),
      this.vendorFeedbackModel.countDocuments(where).exec(),
    ]);

    type LeanUser = {
      _id?: unknown;
      fullName?: string;
      email?: string;
      profileImage?: string;
    };
    const items = rows.map((row) => {
      const vendor = (row.user ?? null) as LeanUser | null;
      return {
        id: String(row._id),
        rate: Number(row.rate) || 0,
        comment:
          typeof row.comment === 'string' && row.comment.trim()
            ? row.comment.trim()
            : null,
        createdAt:
          row.createdAt instanceof Date
            ? row.createdAt.toISOString()
            : new Date(String(row.createdAt ?? Date.now())).toISOString(),
        vendor: {
          id: String(vendor?._id ?? ''),
          fullName: vendor?.fullName?.trim() || 'Vendeur',
          email: vendor?.email?.trim() || null,
          profileImage: vendor?.profileImage?.trim() || null,
        },
      };
    });

    return {
      items,
      total,
      page,
      take,
      hasMore: page * take < total,
      filters: {
        minRate,
        maxRate,
        from: fromRaw || null,
        to: toRaw || null,
      },
    };
  }

  /**
   * Chiffre d’affaires **mois civil en cours** (America/Toronto) vs **même nombre de jours**
   * le mois précédent — pour la tendance %.
   * Admin : toutes les boutiques ; vendeur : ses boutiques uniquement.
   */
  async getDashboardRevenueSummary(
    user: UserModel,
  ): Promise<DashboardRevenueSummary> {
    const empty = (target: number): DashboardRevenueSummary => ({
      revenueMonthToDate: 0,
      revenueComparablePriorMonth: 0,
      trendPercent: null,
      monthlyTarget: target,
    });

    if (user.type !== UserTypeEnum.ADMIN && user.type !== UserTypeEnum.VENDOR) {
      return empty(0);
    }

    let storeIds: Types.ObjectId[] | null = null;
    if (user.type === UserTypeEnum.VENDOR) {
      storeIds = vendorStoreObjectIds(user);
      if (!storeIds.length) {
        return empty(DASHBOARD_CA_MONTHLY_TARGET_VENDOR);
      }
    }

    const z = PEAK_HOURS_TZ;
    const now = dayjs().tz(z);
    const monthStart = now.startOf('month').toDate();
    const monthEndExclusive = now.add(1, 'day').startOf('day').toDate();

    const prevAnchor = now.subtract(1, 'month');
    const prevMonthStart = prevAnchor.startOf('month').toDate();
    const dayCap = Math.min(now.date(), prevAnchor.daysInMonth());
    const prevComparableEndExclusive = prevAnchor
      .date(dayCap)
      .add(1, 'day')
      .startOf('day')
      .toDate();

    const [mtdBreakdown, cmpBreakdown] = await Promise.all([
      this.revenueBreakdownInRange(monthStart, monthEndExclusive, storeIds),
      this.revenueBreakdownInRange(
        prevMonthStart,
        prevComparableEndExclusive,
        storeIds,
      ),
    ]);
    const mtd = mtdBreakdown.total;
    const cmp = cmpBreakdown.total;

    return {
      revenueMonthToDate: mtd,
      revenueComparablePriorMonth: cmp,
      trendPercent: trendPercent(mtd, cmp),
      currency: mtdBreakdown.currency,
      revenueByCurrency: mtdBreakdown.byCurrency,
      comparableRevenueByCurrency: cmpBreakdown.byCurrency,
      monthlyTarget:
        user.type === UserTypeEnum.ADMIN
          ? DASHBOARD_CA_MONTHLY_TARGET_ADMIN
          : DASHBOARD_CA_MONTHLY_TARGET_VENDOR,
    };
  }

  /**
   * KPIs agrégés plateforme — réservé aux administrateurs.
   * Fenêtres calendaires `America/Toronto` (aligné cartes CA / revenus).
   */
  async getAdminKpis(user: UserModel): Promise<AdminDashboardKpis> {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
    return this.getDailyKpis(user);
  }

  /**
   * KPIs du jour — admin (plateforme) ou vendeur (ses boutiques).
   */
  async getDailyKpis(user: UserModel): Promise<AdminDashboardKpis> {
    if (user.type !== UserTypeEnum.ADMIN && user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('forbidden');
    }

    let storeIds: Types.ObjectId[] | null = null;
    if (user.type === UserTypeEnum.VENDOR) {
      storeIds = vendorStoreObjectIds(user);
      if (!storeIds.length) {
        return {
          revenueTodayFcfa: 0,
          revenueYesterdayFcfa: 0,
          revenueTrendPercent: null,
          ordersToday: 0,
          ordersYesterday: 0,
          ordersTrendPercent: null,
          ordersInProgress: 0,
          newClientsToday: 0,
          newClientsYesterday: 0,
          newClientsTrendPercent: null,
          avgDeliveryMinutesToday: null,
          avgDeliveryMinutesYesterday: null,
          deliveryDeltaMinutes: null,
          revenueTargetFcfa: DASHBOARD_CA_MONTHLY_TARGET_VENDOR,
          deliveryTargetMinutes: ADMIN_DELIVERY_TARGET_MIN,
        };
      }
    }

    const z = PEAK_HOURS_TZ;
    const now = dayjs().tz(z);
    const todayStart = now.startOf('day').toDate();
    const todayEnd = now.add(1, 'day').startOf('day').toDate();
    const yesterdayStart = now.subtract(1, 'day').startOf('day').toDate();
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
      this.sumRevenueInRange(todayStart, todayEnd, storeIds),
      this.sumRevenueInRange(yesterdayStart, yesterdayEnd, storeIds),
      this.countOrdersInRange(todayStart, todayEnd, storeIds),
      this.countOrdersInRange(yesterdayStart, yesterdayEnd, storeIds),
      this.countOrdersInFlight(storeIds),
      this.countNewClientsInRange(todayStart, todayEnd, storeIds),
      this.countNewClientsInRange(yesterdayStart, yesterdayEnd, storeIds),
      this.avgCompletedDeliveryMinutes(todayStart, todayEnd, storeIds),
      this.avgCompletedDeliveryMinutes(yesterdayStart, yesterdayEnd, storeIds),
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
      revenueTargetFcfa:
        user.type === UserTypeEnum.ADMIN
          ? ADMIN_REVENUE_TARGET_FCFA
          : DASHBOARD_CA_MONTHLY_TARGET_VENDOR,
      deliveryTargetMinutes: ADMIN_DELIVERY_TARGET_MIN,
    };
  }

  private async countOrdersInFlight(
    storeIds: Types.ObjectId[] | null,
  ): Promise<number> {
    const filter: Record<string, unknown> = {
      status: { $in: ORDER_STATUSES_IN_FLIGHT },
    };
    if (storeIds?.length) {
      filter.store = { $in: storeIds };
    }
    return this.orderModel.countDocuments(filter).exec();
  }

  /** Inscriptions `USER` (admin) ou première commande boutique du jour (vendeur). */
  private async countNewClientsInRange(
    start: Date,
    end: Date,
    storeIds: Types.ObjectId[] | null,
  ): Promise<number> {
    if (!storeIds?.length) {
      return this.userModel
        .countDocuments({
          type: UserTypeEnum.USER,
          createdAt: { $gte: start, $lt: end },
        })
        .exec();
    }

    const orderColl = this.orderModel.collection.name;
    const agg = await this.orderModel
      .aggregate<{ n?: number }>([
        {
          $match: {
            store: { $in: storeIds },
            status: { $ne: OrderStatusEnum.CANCELLED },
            createdAt: { $gte: start, $lte: end },
          },
        },
        {
          $lookup: {
            from: orderColl,
            let: { uid: '$user', sid: '$store', ca: '$createdAt' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$user', '$$uid'] },
                      { $eq: ['$store', '$$sid'] },
                      { $ne: ['$status', OrderStatusEnum.CANCELLED] },
                      { $lt: ['$createdAt', '$$ca'] },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: 'prior',
          },
        },
        { $match: { prior: { $size: 0 } } },
        { $group: { _id: '$user' } },
        { $count: 'n' },
      ])
      .exec();
    return Number(agg[0]?.n) || 0;
  }

  /**
   * Courbe de revenus (7 j / 30 j / 12 mois) — admin (plateforme) ou vendeur (ses boutiques).
   */
  async getDashboardRevenueSeries(
    user: UserModel,
    period: '7d' | '30d' | '12m',
  ): Promise<DashboardRevenueSeriesPayload> {
    if (user.type !== UserTypeEnum.ADMIN && user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('forbidden');
    }

    let storeIds: Types.ObjectId[] | null = null;
    if (user.type === UserTypeEnum.VENDOR) {
      storeIds = vendorStoreObjectIds(user);
      if (!storeIds.length) {
        return {
          period,
          timezone: PEAK_HOURS_TZ,
          total: 0,
          points: [],
        };
      }
    }

    const z = PEAK_HOURS_TZ;
    const now = dayjs().tz(z);
    const points: DashboardRevenueSeriesPoint[] = [];

    if (period === '12m') {
      const start = now.subtract(11, 'month').startOf('month').toDate();
      const endExclusive = now.add(1, 'month').startOf('month').toDate();
      const monthly = await this.aggregateMonthlyRevenue(
        start,
        endExclusive,
        storeIds,
      );
      for (const row of monthly) {
        const d = dayjs.tz(`${row.monthKey}-01`, z);
        points.push({
          label: this.revenueSeriesLabel(d, '12m'),
          date: row.monthKey,
          valeur: Math.round(row.revenue),
        });
      }
      const total = points.reduce((a, p) => a + p.valeur, 0);
      return { period, timezone: z, total, points };
    }

    const days = period === '30d' ? 30 : 7;
    const start = now
      .subtract(days - 1, 'day')
      .startOf('day')
      .toDate();
    const endExclusive = now.add(1, 'day').startOf('day').toDate();
    const daily = await this.aggregateDailyRevenue(
      start,
      endExclusive,
      storeIds,
    );
    for (const row of daily) {
      const d = dayjs.tz(row.date, z);
      points.push({
        label: this.revenueSeriesLabel(d, period),
        date: row.date,
        valeur: Math.round(row.revenue),
      });
    }
    const total = points.reduce((a, p) => a + p.valeur, 0);
    return { period, timezone: z, total, points };
  }

  private revenueSeriesLabel(
    d: dayjs.Dayjs,
    period: '7d' | '30d' | '12m',
  ): string {
    const date = d.toDate();
    if (period === '7d') {
      const wd = date.toLocaleDateString('fr-CA', { weekday: 'short' });
      return wd.charAt(0).toUpperCase() + wd.slice(1).replace(/\.$/, '');
    }
    if (period === '30d') {
      return date.toLocaleDateString('fr-CA', {
        day: 'numeric',
        month: 'short',
      });
    }
    const m = date.toLocaleDateString('fr-CA', { month: 'short' });
    return m.charAt(0).toUpperCase() + m.slice(1).replace(/\.$/, '');
  }

  /**
   * Derniers clients (commandes récentes) + nouveaux inscrits du jour.
   * Admin : plateforme ; vendeur : ses boutiques (alias `vendor/recent-customers`).
   */
  async listRecentCustomers(
    user: UserModel,
  ): Promise<DashboardRecentCustomersPayload> {
    if (user.type === UserTypeEnum.VENDOR) {
      return this.listVendorRecentCustomers(user);
    }
    if (user.type === UserTypeEnum.ADMIN) {
      return this.listAdminRecentCustomers(user);
    }
    throw new ForbiddenException('forbidden');
  }

  private async listAdminRecentCustomers(
    _user: UserModel,
  ): Promise<DashboardRecentCustomersPayload> {
    const z = PEAK_HOURS_TZ;
    const start = dayjs().tz(z).startOf('day').toDate();
    const end = dayjs().tz(z).endOf('day').toDate();

    const newClientsToday = await this.userModel.countDocuments({
      type: UserTypeEnum.USER,
      createdAt: { $gte: start, $lte: end },
    });

    type PopUser = {
      _id: Types.ObjectId;
      fullName?: string;
      profileImage?: string;
    };
    type OrderRecentLean = {
      _id: Types.ObjectId;
      user: Types.ObjectId | PopUser;
      createdAt: Date;
    };

    const recentOrders = (await this.orderModel
      .find({ status: { $ne: OrderStatusEnum.CANCELLED } })
      .sort({ createdAt: -1 })
      .limit(80)
      .populate('user', 'fullName profileImage')
      .lean()
      .exec()) as unknown as OrderRecentLean[];

    const seenUser = new Set<string>();
    const picked: OrderRecentLean[] = [];
    for (const o of recentOrders) {
      const uid =
        typeof o.user === 'object' &&
        o.user !== null &&
        '_id' in o.user &&
        !(o.user instanceof Types.ObjectId)
          ? String((o.user as PopUser)._id)
          : String(o.user);
      if (seenUser.has(uid)) continue;
      seenUser.add(uid);
      picked.push(o);
      if (picked.length >= 5) break;
    }

    const clients: DashboardVendorRecentCustomerRow[] = [];
    for (const o of picked) {
      const pop =
        typeof o.user === 'object' &&
        o.user !== null &&
        '_id' in o.user &&
        !(o.user instanceof Types.ObjectId)
          ? (o.user as PopUser)
          : null;
      if (!pop?._id) continue;

      const priorCount = await this.orderModel.countDocuments({
        user: pop._id,
        status: { $ne: OrderStatusEnum.CANCELLED },
        createdAt: { $lt: o.createdAt },
      });

      const img = String(pop.profileImage ?? '').trim();
      clients.push({
        userId: String(pop._id),
        fullName: String(pop.fullName ?? '').trim() || 'Client',
        profileImage: img.length ? img : null,
        lastOrderAt: o.createdAt.toISOString(),
        isFirstOrderAtStore: priorCount === 0,
      });
    }

    return { newCustomersToday: newClientsToday, clients };
  }

  /**
   * Top boutiques par CA du jour (fuseau Toronto) — admin ou vendeur (ses boutiques).
   */
  async listTopStoresToday(user: UserModel): Promise<DashboardTopStoreRow[]> {
    if (user.type !== UserTypeEnum.ADMIN && user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('forbidden');
    }

    let storeIds: Types.ObjectId[] | null = null;
    if (user.type === UserTypeEnum.VENDOR) {
      storeIds = vendorStoreObjectIds(user);
      if (!storeIds.length) return [];
    }

    const z = PEAK_HOURS_TZ;
    const start = dayjs().tz(z).startOf('day').toDate();
    const endExclusive = dayjs().tz(z).add(1, 'day').startOf('day').toDate();

    const match: Record<string, unknown> = {
      createdAt: { $gte: start, $lt: endExclusive },
      status: { $in: ORDER_STATUSES_FOR_REVENUE },
    };
    if (storeIds?.length) {
      match.store = { $in: storeIds };
    }

    const agg = await this.orderModel
      .aggregate<{
        _id: Types.ObjectId;
        revenue: number;
        commandes: number;
      }>([
        { $match: match },
        {
          $group: {
            _id: '$store',
            revenue: {
              $sum: {
                $ifNull: ['$totalPrice', { $ifNull: ['$total_price', 0] }],
              },
            },
            commandes: { $sum: 1 },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 4 },
      ])
      .exec();

    const storeIdList = agg.map((r) => r._id).filter(Boolean);
    if (!storeIdList.length) return [];

    const stores = await this.storeModel
      .find({ _id: { $in: storeIdList } })
      .select('name')
      .lean()
      .exec();
    const nameById = new Map(
      stores.map((s) => [String(s._id), String(s.name ?? 'Boutique')]),
    );

    const ratingAgg = await this.storeRatingModel
      .aggregate<{ _id: Types.ObjectId; avg: number }>([
        { $match: { store: { $in: storeIdList } } },
        { $group: { _id: '$store', avg: { $avg: '$rate' } } },
      ])
      .exec();
    const ratingByStore = new Map(
      ratingAgg.map((r) => [
        String(r._id),
        typeof r.avg === 'number' && !Number.isNaN(r.avg)
          ? Math.round(r.avg * 10) / 10
          : null,
      ]),
    );

    return agg.map((row) => {
      const sid = String(row._id);
      return {
        storeId: sid,
        name: nameById.get(sid) ?? 'Boutique',
        revenue: Math.round(row.revenue * 100) / 100,
        commandes: row.commandes ?? 0,
        note: ratingByStore.get(sid) ?? null,
      };
    });
  }

  private async aggregateMonthlyRevenue(
    start: Date,
    end: Date,
    storeIds: Types.ObjectId[] | null,
  ): Promise<Array<{ monthKey: string; revenue: number }>> {
    const match: Record<string, unknown> = {
      createdAt: { $gte: start, $lt: end },
      status: { $in: ORDER_STATUSES_FOR_REVENUE },
    };
    if (storeIds?.length) {
      match.store = { $in: storeIds };
    }
    const rows = await this.orderModel
      .aggregate<{ _id: string; revenue: number }>([
        { $match: match },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m',
                date: '$createdAt',
                timezone: PEAK_HOURS_TZ,
              },
            },
            revenue: {
              $sum: {
                $ifNull: ['$totalPrice', { $ifNull: ['$total_price', 0] }],
              },
            },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .exec();
    const byMonth = new Map(
      rows.map((r) => [r._id, typeof r.revenue === 'number' ? r.revenue : 0]),
    );

    const out: Array<{ monthKey: string; revenue: number }> = [];
    let cursor = dayjs(start).tz(PEAK_HOURS_TZ).startOf('month');
    const endExclusive = dayjs(end).tz(PEAK_HOURS_TZ).startOf('month');
    while (cursor.isBefore(endExclusive)) {
      const key = cursor.format('YYYY-MM');
      out.push({ monthKey: key, revenue: byMonth.get(key) ?? 0 });
      cursor = cursor.add(1, 'month');
    }
    return out;
  }

  private async sumRevenueInRange(
    start: Date,
    end: Date,
    storeIds: Types.ObjectId[] | null,
  ): Promise<number> {
    const match: Record<string, unknown> = {
      createdAt: { $gte: start, $lt: end },
      status: { $in: ORDER_STATUSES_FOR_REVENUE },
    };
    if (storeIds?.length) {
      match.store = { $in: storeIds };
    }
    const agg = await this.orderModel
      .aggregate<{ total: number }>([
        { $match: match },
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                $ifNull: ['$totalPrice', { $ifNull: ['$total_price', 0] }],
              },
            },
          },
        },
      ])
      .exec();
    const v = agg[0]?.total;
    return typeof v === 'number' && !Number.isNaN(v) ? v : 0;
  }

  private async stripeCurrencyBySessionIds(
    sessionIds: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(sessionIds.map((s) => s.trim()).filter(Boolean))];
    if (!unique.length) return new Map();
    const docs = await this.stripeProcessedCheckoutModel
      .find({ sessionId: { $in: unique } })
      .select('sessionId currency')
      .lean()
      .exec();
    const out = new Map<string, string>();
    for (const d of docs) {
      const sid = String(d.sessionId ?? '').trim();
      const cur = normalizeCurrencyCode(d.currency);
      if (!sid || !cur) continue;
      out.set(sid, cur);
    }
    return out;
  }

  private resolveDashboardOrderCurrency(
    order: {
      currency?: unknown;
      stripeParentPaymentId?: unknown;
      store?: { currency?: unknown } | unknown;
    },
    stripeCurrencyBySessionId: Map<string, string>,
  ): string {
    const orderCur = normalizeCurrencyCode(order.currency);
    if (orderCur) return orderCur;
    const paymentId = String(order.stripeParentPaymentId ?? '').trim();
    if (paymentId) {
      const stripeCur = stripeCurrencyBySessionId.get(paymentId);
      if (stripeCur) return stripeCur;
    }
    const storeCur = normalizeCurrencyCode(
      (order.store as { currency?: unknown } | undefined)?.currency,
    );
    return storeCur ?? 'CAD';
  }

  private async revenueBreakdownInRange(
    start: Date,
    end: Date,
    storeIds: Types.ObjectId[] | null,
  ): Promise<{
    total: number;
    byCurrency: Array<{ currency: string; amount: number }>;
    currency?: string;
  }> {
    const match: Record<string, unknown> = {
      createdAt: { $gte: start, $lt: end },
      status: { $in: ORDER_STATUSES_FOR_REVENUE },
    };
    if (storeIds?.length) {
      match.store = { $in: storeIds };
    }
    const orders = await this.orderModel
      .find(match)
      .populate<{ store?: { currency?: string } }>('store', 'currency')
      .select('totalPrice currency stripeParentPaymentId store')
      .lean()
      .exec();
    const stripeCurrencyBySessionId = await this.stripeCurrencyBySessionIds(
      orders.map((o) => String(o.stripeParentPaymentId ?? '')),
    );
    const byCurrencyMap = new Map<string, number>();
    for (const o of orders) {
      const currency = this.resolveDashboardOrderCurrency(
        {
          currency: o.currency,
          stripeParentPaymentId: o.stripeParentPaymentId,
          store: o.store,
        },
        stripeCurrencyBySessionId,
      );
      const amount = Number(o.totalPrice);
      pushCurrencyAmount(
        byCurrencyMap,
        currency,
        Number.isFinite(amount) ? amount : 0,
      );
    }
    const byCurrency = breakdownFromCurrencyMap(byCurrencyMap);
    const total = byCurrency.reduce((acc, row) => acc + row.amount, 0);
    return {
      total,
      byCurrency,
      currency: singleCurrencyFromBreakdown(byCurrency),
    };
  }

  private async sumRevenueFcfa(start: Date, end: Date): Promise<number> {
    return this.sumRevenueInRange(start, end, null);
  }

  /**
   * Durée moyenne (minutes) entre création et dernière mise à jour pour les commandes
   * passées en `completed` dans la fenêtre [start, end) (sur `updatedAt`).
   */
  private async avgCompletedDeliveryMinutes(
    start: Date,
    end: Date,
    storeIds: Types.ObjectId[] | null = null,
  ): Promise<number | null> {
    const match: Record<string, unknown> = {
      status: OrderStatusEnum.COMPLETED,
      updatedAt: { $gte: start, $lt: end },
    };
    if (storeIds?.length) {
      match.store = { $in: storeIds };
    }
    const agg = await this.orderModel
      .aggregate<{ avg: number }>([
        {
          $match: match,
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
      $or: [{ quantite: { $lte: 0 } }, { statut: StockStatutEnum.ALERTE }],
    };
    if (vendorStoreIds?.length) {
      filter.store = { $in: vendorStoreIds };
    }

    const rows = await this.stockItemModel
      .find(filter)
      .populate('store', 'name')
      .sort({ updatedAt: -1 })
      .limit(50)
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

  async listDashboardLivreurs(user: UserModel): Promise<DashboardLivreurRow[]> {
    if (user.type === UserTypeEnum.VENDOR) {
      const ids = vendorStoreObjectIds(user);
      if (!ids.length) return [];
      const storePoints = await this.loadVendorStoreGeoPoints(ids);
      const rows = await this.listApprovedDeliveryUsersForDashboard(
        storePoints,
        REGION_DELIVERY_USERS_RADIUS_KM,
        false,
      );
      return this.enrichLivreurRows(rows);
    }
    if (user.type === UserTypeEnum.ADMIN) {
      const storePoints = await this.loadAllStoreGeoPoints();
      const rows = await this.listApprovedDeliveryUsersForDashboard(
        storePoints,
        REGION_DELIVERY_USERS_RADIUS_KM,
        true,
      );
      return this.enrichLivreurRows(rows);
    }
    throw new ForbiddenException('livreurs_access_denied');
  }

  async createDashboardLivreur(
    _user: UserModel,
    _dto: CreateDashboardLivreurDto,
  ): Promise<DashboardLivreurRow> {
    throw new BadRequestException('livreur_create_via_user_application');
  }

  async assignOrderToLivreur(
    user: UserModel,
    dto: AssignDashboardOrderDto,
  ): Promise<DashboardLivreurRow> {
    if (user.type !== UserTypeEnum.ADMIN && user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('livreurs_access_denied');
    }
    if (!Types.ObjectId.isValid(dto.orderId)) {
      throw new BadRequestException('invalid_ids');
    }

    const deliveryUserId = this.parseDeliveryUserId(dto.livreurId);
    if (!deliveryUserId) {
      throw new BadRequestException('invalid_ids');
    }
    return this.assignOrderToAppDeliveryUser(user, dto.orderId, deliveryUserId);
  }

  private parseDeliveryUserId(raw: string): string | null {
    const id = raw.trim();
    if (!id) return null;
    const normalized = id.startsWith('dlusr_') ? id.slice('dlusr_'.length) : id;
    return Types.ObjectId.isValid(normalized) ? normalized : null;
  }

  /** Assignation admin / vendeur → utilisateur `DELIVERY` (candidature approuvée). */
  private async assignOrderToAppDeliveryUser(
    actor: UserModel,
    orderId: string,
    deliveryUserId: string,
  ): Promise<DashboardLivreurRow> {
    const vendorStoreIds =
      actor.type === UserTypeEnum.VENDOR ? vendorStoreObjectIds(actor) : null;
    if (actor.type === UserTypeEnum.VENDOR && !vendorStoreIds?.length) {
      throw new ForbiddenException('vendor_no_store');
    }

    const agentOid = new Types.ObjectId(deliveryUserId);
    const orderOid = new Types.ObjectId(orderId);

    const deliveryUser = await this.userModel
      .findById(agentOid)
      .select('type fullName')
      .lean()
      .exec();
    if (!deliveryUser || deliveryUser.type !== UserTypeEnum.DELIVERY) {
      throw new NotFoundException('livreur_not_found');
    }

    const application = await this.deliveryAgentApplicationModel
      .findOne({
        user: agentOid,
        status: DeliveryAgentApplicationStatus.APPROVED,
      })
      .lean()
      .exec();
    if (!application) {
      throw new BadRequestException('livreur_not_available');
    }
    if (application.dashboardAvailability === 'hors_ligne') {
      throw new BadRequestException('livreur_not_available');
    }

    const activeForAgent = await this.orderModel
      .findOne({
        assignedDeliveryUser: agentOid,
        shouldShip: true,
        status: OrderStatusEnum.SHIPPED,
      })
      .select('_id')
      .lean()
      .exec();
    if (activeForAgent && String(activeForAgent._id) !== orderId) {
      throw new BadRequestException('livreur_not_available');
    }

    const orderDoc = await this.orderModel
      .findById(orderOid)
      .populate('store', 'name owner address')
      .populate({
        path: 'user',
        select: 'fullName addresses',
        populate: { path: 'addresses' },
      })
      .exec();
    if (!orderDoc) throw new NotFoundException('order_not_found');
    if (!orderDoc.shouldShip) {
      throw new BadRequestException('order_not_shippable');
    }

    const orderStoreId =
      orderDoc.store &&
      typeof orderDoc.store === 'object' &&
      '_id' in orderDoc.store
        ? String((orderDoc.store as { _id: unknown })._id)
        : '';
    if (!orderStoreId) throw new BadRequestException('order_store_missing');
    if (vendorStoreIds?.length) {
      if (!vendorStoreIds.some((s) => s.toString() === orderStoreId)) {
        throw new ForbiddenException('store_forbidden');
      }
    }

    const existingAssignee = orderDoc.assignedDeliveryUser;
    if (existingAssignee && String(existingAssignee) !== deliveryUserId) {
      throw new BadRequestException('order_assigned_to_other');
    }
    if (
      ![
        OrderStatusEnum.CREATED,
        OrderStatusEnum.PAIED,
        OrderStatusEnum.APPROVED,
      ].includes(orderDoc.status as OrderStatusEnum)
    ) {
      throw new BadRequestException('order_not_assignable');
    }

    const prevOrderStatus = orderDoc.status as OrderStatusEnum;
    orderDoc.set('assignedDeliveryUser', agentOid);
    orderDoc.status = OrderStatusEnum.SHIPPED;
    await orderDoc.save();

    const customerId = this.customerUserIdForOrderPush(orderDoc);
    const agentName = deliveryUser.fullName?.trim() || 'Livreur app';

    if (prevOrderStatus !== OrderStatusEnum.SHIPPED) {
      await this.orderStatusEvents.record({
        orderId: orderDoc._id.toString(),
        storeId: orderStoreId,
        customerUserId: customerId ?? undefined,
        fromStatus: prevOrderStatus,
        toStatus: OrderStatusEnum.SHIPPED,
        source: OrderStatusChangeSourceEnum.DASHBOARD,
        actorUserId: String(actor.id),
        note: `Livreur app ${agentName}`,
      });
    }

    if (customerId && prevOrderStatus !== OrderStatusEnum.SHIPPED) {
      void this.notificationsService
        .pushCustomerOrderStatusChanged({
          userId: customerId,
          orderId: orderDoc._id.toString(),
          storeName: this.storeNameForOrderPush(orderDoc),
          storeId: orderStoreId || undefined,
          previousStatus: prevOrderStatus,
          newStatus: OrderStatusEnum.SHIPPED,
          bodyOverride: 'En cours de livraison',
        })
        .catch((err) => {
          this.logger.warn(
            `FCM order shipped (app livreur): ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
      this.ordersService.notifyPartiesOrderRealtimeFromDoc(
        orderDoc,
        OrderStatusEnum.SHIPPED,
      );
    }

    if (orderStoreId && prevOrderStatus !== OrderStatusEnum.SHIPPED) {
      const sname = this.storeNameForOrderPush(orderDoc);
      const vendorIds = await this.storeAccess.listStorePushRecipientUserIds(
        orderStoreId,
      );
      if (vendorIds.length > 0) {
        void this.notificationsService
          .pushVendorOrderNotify({
            vendorUserIds: vendorIds,
            title: 'Commande en livraison',
            body: `${
              sname ?? 'Boutique'
            } : commande prise en charge par ${agentName}.`,
            orderId: orderDoc._id.toString(),
            storeName: sname,
            reason: 'order_shipped',
            status: OrderStatusEnum.SHIPPED,
          })
          .catch((err) => {
            this.logger.warn(
              `FCM vendor order shipped: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          });
      }
    }

    const rows = await this.listDashboardLivreurs(actor);
    const row = rows.find((r) => r.id === deliveryUserId);
    if (!row) {
      throw new NotFoundException('livreur_not_found');
    }
    return row;
  }

  async updateDashboardLivreurStatut(
    user: UserModel,
    livreurId: string,
    statut: 'disponible' | 'hors_ligne',
  ): Promise<DashboardLivreurRow> {
    if (user.type !== UserTypeEnum.ADMIN && user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('livreurs_access_denied');
    }
    const deliveryUserId = this.parseDeliveryUserId(livreurId);
    if (!deliveryUserId) {
      throw new BadRequestException('invalid_livreur_id');
    }

    const agentOid = new Types.ObjectId(deliveryUserId);
    const application = await this.deliveryAgentApplicationModel
      .findOne({
        user: agentOid,
        status: DeliveryAgentApplicationStatus.APPROVED,
      })
      .exec();
    if (!application) {
      throw new NotFoundException('livreur_not_found');
    }

    if (statut === 'hors_ligne') {
      const active = await this.orderModel
        .findOne({
          assignedDeliveryUser: agentOid,
          shouldShip: true,
          status: OrderStatusEnum.SHIPPED,
        })
        .select('_id')
        .lean()
        .exec();
      if (active) {
        throw new BadRequestException('livreur_has_active_order');
      }
      application.dashboardAvailability = 'hors_ligne';
    } else {
      if (application.dashboardAvailability !== 'hors_ligne') {
        throw new BadRequestException('livreur_reactivate_only_when_offline');
      }
      application.dashboardAvailability = 'disponible';
    }
    await application.save();

    const rows = await this.listDashboardLivreurs(user);
    const row = rows.find((r) => r.id === deliveryUserId);
    if (!row) {
      throw new NotFoundException('livreur_not_found');
    }
    return row;
  }

  private storeNameFromPopulated(
    store: { name?: string } | Types.ObjectId | null | undefined,
  ): { storeName: string } {
    if (store && typeof store === 'object' && 'name' in store) {
      const n = (store as { name?: string }).name?.trim();
      if (n) return { storeName: n };
    }
    return { storeName: '' };
  }

  private mergeLivreurRowsById(
    rows: DashboardLivreurRow[],
  ): DashboardLivreurRow[] {
    const byId = new Map<string, DashboardLivreurRow>();
    for (const r of rows) {
      const key = this.parseDeliveryUserId(r.id) ?? r.id;
      const normalized = { ...r, id: key };
      if (!byId.has(key)) byId.set(key, normalized);
    }
    const out = Array.from(byId.values());
    out.sort((a, b) =>
      a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }),
    );
    return out;
  }

  private startOfTodayUtc(): Date {
    return dayjs().utc().startOf('day').toDate();
  }

  private async enrichLivreurRows(
    rows: DashboardLivreurRow[],
  ): Promise<DashboardLivreurRow[]> {
    if (!rows.length) return rows;

    const userIds = rows
      .map((r) => this.parseDeliveryUserId(r.id))
      .filter((id): id is string => id != null)
      .map((id) => new Types.ObjectId(id));

    if (!userIds.length) return this.attachStoreNamesToLivreurRows(rows);

    const startOfDay = this.startOfTodayUtc();

    const [todayAgg, totalAgg, activeOrders, applications] = await Promise.all([
      this.orderModel
        .aggregate<{ _id: Types.ObjectId; count: number }>([
          {
            $match: {
              assigned_delivery_user: { $in: userIds },
              status: OrderStatusEnum.COMPLETED,
              updatedAt: { $gte: startOfDay },
            },
          },
          { $group: { _id: '$assigned_delivery_user', count: { $sum: 1 } } },
        ])
        .exec(),
      this.orderModel
        .aggregate<{ _id: Types.ObjectId; count: number }>([
          {
            $match: {
              assigned_delivery_user: { $in: userIds },
              status: OrderStatusEnum.COMPLETED,
            },
          },
          { $group: { _id: '$assigned_delivery_user', count: { $sum: 1 } } },
        ])
        .exec(),
      this.orderModel
        .find({
          assignedDeliveryUser: { $in: userIds },
          status: OrderStatusEnum.SHIPPED,
        })
        .populate({
          path: 'user',
          select: 'fullName addresses',
          populate: { path: 'addresses' },
        })
        .sort({ updatedAt: -1 })
        .lean()
        .exec(),
      this.deliveryAgentApplicationModel
        .find({
          user: { $in: userIds },
          status: DeliveryAgentApplicationStatus.APPROVED,
        })
        .select(
          'user lastLatitude lastLongitude locationUpdatedAt dashboardAvailability vehicle vehicleRegistration maxConcurrentOrders serviceZone',
        )
        .lean()
        .exec(),
    ]);

    const todayByUser = new Map(todayAgg.map((x) => [String(x._id), x.count]));
    const totalByUser = new Map(totalAgg.map((x) => [String(x._id), x.count]));
    const activeByUser = new Map<string, (typeof activeOrders)[0]>();
    for (const o of activeOrders) {
      const uid = o.assignedDeliveryUser ? String(o.assignedDeliveryUser) : '';
      if (uid && !activeByUser.has(uid)) activeByUser.set(uid, o);
    }
    const appByUser = new Map(applications.map((a) => [String(a.user), a]));

    const enriched = rows.map((row) => {
      const uid = this.parseDeliveryUserId(row.id);
      if (!uid) return row;

      const appDoc = appByUser.get(uid);
      let longitude = row.longitude;
      let latitude = row.latitude;
      if (
        appDoc &&
        typeof appDoc.lastLatitude === 'number' &&
        typeof appDoc.lastLongitude === 'number' &&
        Number.isFinite(appDoc.lastLatitude) &&
        Number.isFinite(appDoc.lastLongitude) &&
        !(appDoc.lastLatitude === 0 && appDoc.lastLongitude === 0)
      ) {
        longitude = appDoc.lastLongitude;
        latitude = appDoc.lastLatitude;
      }

      const active = activeByUser.get(uid);
      let statut = row.statut;
      let commande_en_cours = row.commande_en_cours;
      const locUpdatedMs = appDoc?.locationUpdatedAt
        ? new Date(appDoc.locationUpdatedAt).getTime()
        : 0;
      const locationStaleMs = 18 * 60 * 1000;
      const hasFreshLocation =
        locUpdatedMs > 0 && Date.now() - locUpdatedMs < locationStaleMs;
      if (active) {
        statut = 'en_livraison';
        const tail = String(active._id).slice(-6).toUpperCase();
        const userAny = active.user as
          | {
              fullName?: string;
              addresses?: Array<{
                isDefault?: boolean;
                address?: string;
                city?: string;
                zipCode?: string;
              }>;
            }
          | null
          | undefined;
        const clientName = userAny?.fullName?.trim() || 'Client';
        const addr =
          userAny?.addresses?.find((a) => a?.isDefault) ||
          userAny?.addresses?.[0] ||
          null;
        const adresse = [addr?.address, addr?.city, addr?.zipCode]
          .filter((x) => typeof x === 'string' && x.trim().length > 0)
          .join(', ');
        commande_en_cours = {
          id: `#AE-${tail}`,
          client: clientName,
          adresse: adresse || '—',
          eta: '30 min',
        };
      } else if (appDoc?.dashboardAvailability === 'hors_ligne') {
        statut = 'hors_ligne';
        commande_en_cours = null;
      } else if (locUpdatedMs > 0 && !hasFreshLocation) {
        statut = 'hors_ligne';
        commande_en_cours = null;
      } else if (statut !== 'hors_ligne') {
        statut = 'disponible';
        commande_en_cours = null;
      }

      const immatFromApp = appDoc?.vehicleRegistration?.trim();
      const vehiculeLabel = deliveryVehicleLabelFr(appDoc?.vehicle);
      const capacite =
        typeof appDoc?.maxConcurrentOrders === 'number' &&
        appDoc.maxConcurrentOrders >= 1
          ? appDoc.maxConcurrentOrders
          : defaultDeliveryCapacity(appDoc?.vehicle);
      const immat =
        immatFromApp && immatFromApp.length > 0
          ? immatFromApp
          : appDoc?.vehicle === 'velo'
          ? '—'
          : '—';
      const zoneSuffix = appDoc?.serviceZone?.trim();
      const zone = zoneSuffix && zoneSuffix.length > 0 ? zoneSuffix : row.zone;

      return {
        ...row,
        statut,
        commande_en_cours,
        livraisons_jour: todayByUser.get(uid) ?? 0,
        livraisons_total: totalByUser.get(uid) ?? 0,
        longitude,
        latitude,
        coords: coordsFromLngLat(longitude, latitude),
        vehicule: vehiculeLabel,
        immat,
        capacite,
        zone,
      };
    });
    return this.attachStoreNamesToLivreurRows(enriched);
  }

  private async attachStoreNamesToLivreurRows(
    rows: DashboardLivreurRow[],
  ): Promise<DashboardLivreurRow[]> {
    const missing = rows.filter((r) => !r.storeName?.trim() && r.storeId);
    if (!missing.length) return rows;
    const ids = [
      ...new Set(
        missing
          .map((r) => r.storeId)
          .filter((id) => Types.ObjectId.isValid(id))
          .map((id) => new Types.ObjectId(id)),
      ),
    ];
    if (!ids.length) return rows;
    const stores = await this.storeModel
      .find({ _id: { $in: ids } })
      .select('name')
      .lean()
      .exec();
    const names = new Map(
      stores.map((s) => [String(s._id), String(s.name ?? '').trim()]),
    );
    return rows.map((r) => ({
      ...r,
      storeName: r.storeName?.trim() || names.get(r.storeId) || '',
    }));
  }

  private async loadAllStoreGeoPoints(): Promise<VendorStorePoint[]> {
    const stores = await this.storeModel
      .find({})
      .populate({ path: 'address', select: 'location' })
      .lean()
      .exec();
    const out: VendorStorePoint[] = [];
    for (const s of stores) {
      const addr = s.address as
        | { location?: { coordinates?: number[] } }
        | undefined;
      const c = addr?.location?.coordinates;
      if (
        !Array.isArray(c) ||
        c.length < 2 ||
        (Number(c[0]) === 0 && Number(c[1]) === 0)
      ) {
        continue;
      }
      out.push({
        storeId: String(s._id),
        lng: Number(c[0]),
        lat: Number(c[1]),
      });
    }
    return out;
  }

  private async loadVendorStoreGeoPoints(
    storeIds: Types.ObjectId[],
  ): Promise<VendorStorePoint[]> {
    const stores = await this.storeModel
      .find({ _id: { $in: storeIds } })
      .populate({ path: 'address', select: 'location' })
      .lean()
      .exec();
    const out: VendorStorePoint[] = [];
    for (const s of stores) {
      const addr = s.address as
        | { location?: { coordinates?: number[] } }
        | undefined;
      const c = addr?.location?.coordinates;
      if (
        !Array.isArray(c) ||
        c.length < 2 ||
        (Number(c[0]) === 0 && Number(c[1]) === 0)
      ) {
        continue;
      }
      out.push({
        storeId: String(s._id),
        lng: Number(c[0]),
        lat: Number(c[1]),
      });
    }
    return out;
  }

  /**
   * Livreurs = utilisateurs DELIVERY avec candidature APPROVED (plus de collection `delivery_drivers`).
   */
  private async listApprovedDeliveryUsersForDashboard(
    storePoints: VendorStorePoint[],
    radiusKm: number,
    includeAllApprovedForAdmin: boolean,
  ): Promise<DashboardLivreurRow[]> {
    const rows = await this.listDeliveryUsersFromApplicationGps(
      storePoints,
      radiusKm,
      includeAllApprovedForAdmin,
    );
    return this.mergeLivreurRowsById(rows);
  }

  private async listDeliveryUsersFromApplicationGps(
    storePoints: VendorStorePoint[],
    radiusKm: number,
    includeAllApprovedForAdmin: boolean,
  ): Promise<DashboardLivreurRow[]> {
    const applications = await this.deliveryAgentApplicationModel
      .find({ status: DeliveryAgentApplicationStatus.APPROVED })
      .populate({
        path: 'user',
        match: { type: UserTypeEnum.DELIVERY },
        select: 'fullName phoneNumber profileImage type addresses',
        populate: { path: 'addresses', select: 'isDefault city location' },
      })
      .lean()
      .exec();

    const rows: DashboardLivreurRow[] = [];
    const fallbackStore = storePoints[0];

    for (const app of applications) {
      const u = app.user as unknown as DeliveryUserLean | null;
      if (!u?._id) continue;

      let lng: number | null = null;
      let lat: number | null = null;
      let cityLabel = app.serviceZone?.trim() || '—';

      if (
        typeof app.lastLatitude === 'number' &&
        typeof app.lastLongitude === 'number' &&
        Number.isFinite(app.lastLatitude) &&
        Number.isFinite(app.lastLongitude) &&
        !(app.lastLatitude === 0 && app.lastLongitude === 0)
      ) {
        lng = app.lastLongitude;
        lat = app.lastLatitude;
      } else {
        const addrs = (u.addresses ?? []) as PopulatedAddressLean[];
        const chosen =
          addrs.find((a) => a.isDefault) ??
          addrs.find((a) => {
            const c = a.location?.coordinates;
            return (
              Array.isArray(c) &&
              c.length >= 2 &&
              !(Number(c[0]) === 0 && Number(c[1]) === 0)
            );
          });
        if (chosen?.location?.coordinates) {
          lng = Number(chosen.location.coordinates[0]);
          lat = Number(chosen.location.coordinates[1]);
          if (chosen.city?.trim()) cityLabel = chosen.city.trim();
        }
      }

      if (lng == null || lat == null) {
        if (!includeAllApprovedForAdmin || !fallbackStore) continue;
        lng = fallbackStore.lng;
        lat = fallbackStore.lat;
      }

      let bestStoreId = fallbackStore?.storeId ?? '';
      let bestKm = Number.POSITIVE_INFINITY;
      if (storePoints.length) {
        for (const sp of storePoints) {
          const d = haversineKm(lng, lat, sp.lng, sp.lat);
          if (d < bestKm) {
            bestKm = d;
            bestStoreId = sp.storeId;
          }
        }
        if (!includeAllApprovedForAdmin && bestKm > radiusKm) continue;
      }

      const initialStatut =
        app.dashboardAvailability === 'hors_ligne'
          ? 'hors_ligne'
          : 'disponible';
      rows.push(
        this.toDashboardLivreurRowFromDeliveryUser(
          u,
          cityLabel,
          lng,
          lat,
          bestStoreId,
          initialStatut,
          app,
        ),
      );
    }
    return rows;
  }

  private toDashboardLivreurRowFromDeliveryUser(
    u: DeliveryUserLean,
    cityLabel: string,
    longitude: number,
    latitude: number,
    nearestStoreId: string,
    initialStatut: DashboardLivreurRow['statut'] = 'disponible',
    app?: {
      vehicle?: string;
      vehicleRegistration?: string;
      maxConcurrentOrders?: number;
      serviceZone?: string;
    },
  ): DashboardLivreurRow {
    const coords = coordsFromLngLat(longitude, latitude);
    const { avatar, profileImageUrl } = resolveDashboardLivreurAvatar(
      u.fullName,
      u.profileImage,
    );
    const vehiculeLabel = deliveryVehicleLabelFr(
      app?.vehicle as 'moto' | 'velo' | 'voiture' | undefined,
    );
    const immat = app?.vehicleRegistration?.trim() || '—';
    const capacite =
      typeof app?.maxConcurrentOrders === 'number' &&
      app.maxConcurrentOrders >= 1
        ? app.maxConcurrentOrders
        : defaultDeliveryCapacity(app?.vehicle);
    const zone = app?.serviceZone?.trim() || cityLabel || '—';
    return {
      id: String(u._id),
      nom: u.fullName?.trim() || 'Livreur',
      avatar,
      profileImageUrl,
      tel: u.phoneNumber?.trim() || '—',
      statut: initialStatut,
      zone,
      vehicule: vehiculeLabel,
      immat,
      note: 0,
      livraisons_jour: 0,
      livraisons_total: 0,
      temps_moyen: 0,
      distance_jour: 0,
      revenu_jour: 0,
      capacite,
      commande_en_cours: null,
      coords,
      longitude,
      latitude,
      storeId: nearestStoreId,
      storeName: '',
      source: 'user',
    };
  }

  private async resolveStoreForLivreurCreation(
    user: UserModel,
    dtoStoreId?: string,
  ): Promise<{
    storeId: Types.ObjectId;
    storeLean: Record<string, unknown> | null;
  }> {
    if (user.type === UserTypeEnum.ADMIN) {
      if (!dtoStoreId?.trim() || !Types.ObjectId.isValid(dtoStoreId)) {
        throw new BadRequestException('store_id_required');
      }
      const id = new Types.ObjectId(dtoStoreId);
      const found = await this.storeModel
        .findById(id)
        .populate({ path: 'address', select: 'location' })
        .lean()
        .exec();
      if (!found) throw new BadRequestException('store_not_found');
      return { storeId: id, storeLean: found as Record<string, unknown> };
    }
    if (user.type === UserTypeEnum.VENDOR) {
      const ids = vendorStoreObjectIds(user);
      if (!ids.length) throw new ForbiddenException('vendor_no_store');
      let chosen: Types.ObjectId;
      if (ids.length === 1) {
        chosen = ids[0];
      } else {
        if (!dtoStoreId?.trim() || !Types.ObjectId.isValid(dtoStoreId)) {
          throw new BadRequestException('store_id_required');
        }
        chosen = new Types.ObjectId(dtoStoreId);
        if (!ids.some((x) => x.equals(chosen))) {
          throw new ForbiddenException('store_forbidden');
        }
      }
      const found = await this.storeModel
        .findById(chosen)
        .populate({ path: 'address', select: 'location' })
        .lean()
        .exec();
      if (!found) throw new BadRequestException('store_not_found');
      return { storeId: chosen, storeLean: found as Record<string, unknown> };
    }
    throw new ForbiddenException('livreurs_access_denied');
  }

  private pickInitialLngLatFromStoreLean(
    storeLean: Record<string, unknown> | null,
  ): { longitude: number; latitude: number } {
    if (!storeLean) return randomLngLatInBbox();
    const addr = storeLean.address as
      | { location?: { coordinates?: number[] } }
      | undefined;
    const c = addr?.location?.coordinates;
    if (
      Array.isArray(c) &&
      c.length >= 2 &&
      !(Number(c[0]) === 0 && Number(c[1]) === 0)
    ) {
      return randomLngLatNearPoint(Number(c[0]), Number(c[1]));
    }
    return randomLngLatInBbox();
  }

  /**
   * Performance financière hebdomadaire par utilisateur (clients + vendeurs).
   * Admin : plateforme ; vendeur : clients de ses boutiques + sa ligne vendeur.
   */
  async getFinanceWeeklyUserPerformance(
    user: UserModel,
  ): Promise<FinanceWeeklyUserPerformancePayload> {
    if (user.type !== UserTypeEnum.ADMIN && user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('forbidden');
    }

    const storeIds =
      user.type === UserTypeEnum.VENDOR ? vendorStoreObjectIds(user) : null;
    if (user.type === UserTypeEnum.VENDOR && !storeIds?.length) {
      const z = PEAK_HOURS_TZ;
      const now = dayjs().tz(z);
      const weekStart = now.startOf('isoWeek');
      return {
        timezone: z,
        weekStart: weekStart.toISOString(),
        weekEnd: weekStart.add(1, 'week').toISOString(),
        priorWeekStart: weekStart.subtract(1, 'week').toISOString(),
        priorWeekEnd: weekStart.toISOString(),
        summary: {
          revenueThisWeek: 0,
          revenuePriorWeek: 0,
          revenueTrendPercent: null,
          ordersThisWeek: 0,
          ordersPriorWeek: 0,
          ordersTrendPercent: null,
          activeClientsThisWeek: 0,
          activeVendorsThisWeek: 0,
        },
        clients: [],
        vendors: [],
      };
    }

    const z = PEAK_HOURS_TZ;
    const now = dayjs().tz(z);
    const weekStart = now.startOf('isoWeek').toDate();
    const weekEnd = now.startOf('isoWeek').add(1, 'week').toDate();
    const priorWeekStart = now.startOf('isoWeek').subtract(1, 'week').toDate();
    const priorWeekEnd = weekStart;

    const limit = user.type === UserTypeEnum.ADMIN ? 50 : 30;
    const rawVendorId =
      user.type === UserTypeEnum.VENDOR
        ? (user as UserModel & { _id?: Types.ObjectId | string })._id ?? user.id
        : null;
    const vendorSelfId =
      rawVendorId instanceof Types.ObjectId
        ? rawVendorId.toString()
        : rawVendorId != null
        ? String(rawVendorId)
        : '';

    const [
      clientsThis,
      clientsPrior,
      vendorsThisRaw,
      vendorsPriorRaw,
      weeklyThis,
      weeklyPrior,
    ] = await Promise.all([
      this.aggregateWeeklyClientTotals(weekStart, weekEnd, storeIds, limit),
      this.aggregateWeeklyClientTotals(
        priorWeekStart,
        priorWeekEnd,
        storeIds,
        500,
      ),
      this.aggregateWeeklyVendorTotals(
        weekStart,
        weekEnd,
        storeIds,
        user.type === UserTypeEnum.ADMIN ? limit : 50,
      ),
      this.aggregateWeeklyVendorTotals(
        priorWeekStart,
        priorWeekEnd,
        storeIds,
        500,
      ),
      this.weeklyCurrencyBreakdown(weekStart, weekEnd, storeIds),
      this.weeklyCurrencyBreakdown(priorWeekStart, priorWeekEnd, storeIds),
    ]);

    const filterVendorRows = (
      rows: {
        userId: string;
        orderCount: number;
        totalSpent: number;
        shippingTotal: number;
      }[],
    ) =>
      user.type === UserTypeEnum.VENDOR && vendorSelfId
        ? rows.filter((r) => r.userId === vendorSelfId)
        : rows;

    const vendorsThis = filterVendorRows(vendorsThisRaw);
    const vendorsPrior = filterVendorRows(vendorsPriorRaw);

    const priorClientMap = new Map(
      clientsPrior.map((r) => [r.userId, r.totalSpent]),
    );
    const priorVendorMap = new Map(
      vendorsPrior.map((r) => [r.userId, r.totalSpent]),
    );

    const clientsBase = await this.hydrateWeeklyPerformanceRows(
      clientsThis,
      priorClientMap,
    );
    const vendorsBase = await this.hydrateWeeklyPerformanceRows(
      vendorsThis,
      priorVendorMap,
    );
    const toBreakdownRows = (map: Map<string, number> | undefined) =>
      map ? breakdownFromCurrencyMap(map) : [];
    const clients = clientsBase.map((row) => {
      const totalSpentByCurrency = toBreakdownRows(
        weeklyThis.clientByUser.get(row.userId),
      );
      const priorTotalSpentByCurrency = toBreakdownRows(
        weeklyPrior.clientByUser.get(row.userId),
      );
      return {
        ...row,
        currency: singleCurrencyFromBreakdown(totalSpentByCurrency),
        totalSpentByCurrency,
        priorTotalSpentByCurrency,
      };
    });
    const vendors = vendorsBase.map((row) => {
      const totalSpentByCurrency = toBreakdownRows(
        weeklyThis.vendorByUser.get(row.userId),
      );
      const priorTotalSpentByCurrency = toBreakdownRows(
        weeklyPrior.vendorByUser.get(row.userId),
      );
      return {
        ...row,
        currency: singleCurrencyFromBreakdown(totalSpentByCurrency),
        totalSpentByCurrency,
        priorTotalSpentByCurrency,
      };
    });
    const revenueThisWeek = weeklyThis.total;
    const revenuePriorWeek = weeklyPrior.total;
    const ordersThisWeek = weeklyThis.orderCount;
    const ordersPriorWeek = weeklyPrior.orderCount;

    return {
      timezone: z,
      weekStart: weekStart.toISOString(),
      weekEnd: weekEnd.toISOString(),
      priorWeekStart: priorWeekStart.toISOString(),
      priorWeekEnd: priorWeekEnd.toISOString(),
      summary: {
        revenueThisWeek,
        revenuePriorWeek,
        revenueTrendPercent: trendPercent(revenueThisWeek, revenuePriorWeek),
        ordersThisWeek,
        ordersPriorWeek,
        ordersTrendPercent: trendPercent(ordersThisWeek, ordersPriorWeek),
        activeClientsThisWeek: clientsThis.length,
        activeVendorsThisWeek:
          user.type === UserTypeEnum.ADMIN
            ? vendorsThis.length
            : vendors.length,
        currency: weeklyThis.currency,
        revenueByCurrency: weeklyThis.revenueByCurrency,
        priorRevenueByCurrency: weeklyPrior.revenueByCurrency,
      },
      clients,
      vendors,
    };
  }

  /**
   * Rapport financier sur une période (inclusive), fuseau America/Toronto.
   * Admin : plateforme ; vendeur : ses boutiques.
   */
  async getFinancePeriodReport(
    user: UserModel,
    fromStr: string,
    toStr: string,
  ): Promise<FinancePeriodReportPayload> {
    if (user.type !== UserTypeEnum.ADMIN && user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('forbidden');
    }

    const z = PEAK_HOURS_TZ;
    const fromDay = dayjs.tz(fromStr, z).startOf('day');
    const toDay = dayjs.tz(toStr, z).startOf('day');
    if (!fromDay.isValid() || !toDay.isValid()) {
      throw new BadRequestException('invalid_date_range');
    }
    if (toDay.isBefore(fromDay)) {
      throw new BadRequestException('invalid_date_range');
    }
    const spanDays = toDay.diff(fromDay, 'day') + 1;
    if (spanDays > 366) {
      throw new BadRequestException('date_range_too_long');
    }

    const start = fromDay.toDate();
    const endExclusive = toDay.add(1, 'day').toDate();
    const priorEndExclusive = fromDay.toDate();
    const priorStart = fromDay.subtract(spanDays, 'day').toDate();
    const priorFromLabel = dayjs(priorStart).tz(z).format('YYYY-MM-DD');
    const priorToLabel = fromDay.subtract(1, 'day').format('YYYY-MM-DD');

    let storeIds: Types.ObjectId[] | null = null;
    if (user.type === UserTypeEnum.VENDOR) {
      storeIds = vendorStoreObjectIds(user);
      if (!storeIds.length) {
        return {
          timezone: z,
          from: fromStr,
          to: toStr,
          priorFrom: priorFromLabel,
          priorTo: priorToLabel,
          summary: {
            totalRevenue: 0,
            orderCount: 0,
            avgOrderValue: 0,
            shippingTotal: 0,
            priorPeriodRevenue: 0,
            trendPercent: null,
          },
          daily: [],
          orders: [],
        };
      }
    }

    const match: Record<string, unknown> = {
      createdAt: { $gte: start, $lt: endExclusive },
      status: { $in: ORDER_STATUSES_FOR_REVENUE },
    };
    if (storeIds?.length) {
      match.store = { $in: storeIds };
    }

    const [
      totalRevenue,
      orderCount,
      shippingTotal,
      priorPeriodRevenue,
      dailyAgg,
      orderDocs,
    ] = await Promise.all([
      this.sumRevenueInRange(start, endExclusive, storeIds),
      this.countOrdersInRange(start, endExclusive, storeIds),
      this.sumShippingInRange(start, endExclusive, storeIds),
      this.sumRevenueInRange(priorStart, priorEndExclusive, storeIds),
      this.aggregateDailyRevenue(start, endExclusive, storeIds),
      this.orderModel
        .find(match)
        .sort({ createdAt: -1 })
        .limit(5000)
        .populate<{ user?: { fullName?: string; email?: string } }>(
          'user',
          'fullName email',
        )
        .populate<{ store?: { name?: string; currency?: string } }>(
          'store',
          'name currency',
        )
        .select(
          '_id createdAt totalPrice shippingPrice currency stripeParentPaymentId status user store stripeProcessingFeeCents',
        )
        .lean()
        .exec(),
    ]);

    const missingCurrencyByPaymentId = new Map<string, true>();
    for (const o of orderDocs) {
      const orderCurrency = normalizeCurrencyCode((o as { currency?: unknown }).currency);
      if (orderCurrency) continue;
      const paymentId = String(
        (o as { stripeParentPaymentId?: unknown }).stripeParentPaymentId ?? '',
      ).trim();
      if (!paymentId) continue;
      missingCurrencyByPaymentId.set(paymentId, true);
    }

    const stripeCurrencyByPaymentId = new Map<string, string>();
    if (missingCurrencyByPaymentId.size > 0) {
      const stripeDocs = await this.stripeProcessedCheckoutModel
        .find({ sessionId: { $in: [...missingCurrencyByPaymentId.keys()] } })
        .select('sessionId currency')
        .lean()
        .exec();
      for (const d of stripeDocs) {
        const sid = String(d.sessionId ?? '').trim();
        const cur = normalizeCurrencyCode(d.currency);
        if (!sid || !cur) continue;
        stripeCurrencyByPaymentId.set(sid, cur);
      }
    }

    const orders: FinancePeriodReportOrderRow[] = orderDocs.map((o) => {
      const id = String(o._id);
      const userDoc = o.user as
        | { fullName?: string; email?: string }
        | undefined;
      const storeDoc = o.store as { name?: string; currency?: string } | undefined;
      const parentPaymentId = String(
        (o as { stripeParentPaymentId?: unknown }).stripeParentPaymentId ?? '',
      ).trim();
      const currency =
        normalizeCurrencyCode((o as { currency?: unknown }).currency) ||
        (parentPaymentId
          ? stripeCurrencyByPaymentId.get(parentPaymentId)
          : undefined) ||
        normalizeCurrencyCode(storeDoc?.currency) ||
        'CAD';
      return {
        id,
        orderNumber: `#AE-${id.slice(-6).toUpperCase()}`,
        createdAt: o.createdAt
          ? new Date(o.createdAt).toISOString()
          : new Date().toISOString(),
        customerName: userDoc?.fullName?.trim() || '—',
        customerEmail: userDoc?.email?.trim() || '',
        totalPrice:
          typeof o.totalPrice === 'number' && !Number.isNaN(o.totalPrice)
            ? o.totalPrice
            : 0,
        shippingPrice:
          typeof o.shippingPrice === 'number' && !Number.isNaN(o.shippingPrice)
            ? o.shippingPrice
            : 0,
        status: String(o.status ?? ''),
        storeName: storeDoc?.name?.trim() || null,
        stripeProcessingFeeCents:
          typeof o.stripeProcessingFeeCents === 'number' &&
          Number.isFinite(o.stripeProcessingFeeCents)
            ? Math.max(0, Math.round(o.stripeProcessingFeeCents))
            : 0,
        currency,
      };
    });

    const reportCurrencySet = new Set(
      orders.map((o) => normalizeCurrencyCode(o.currency)).filter(Boolean),
    );
    const reportCurrency =
      reportCurrencySet.size === 1
        ? [...reportCurrencySet][0]
        : undefined;

    return {
      timezone: z,
      from: fromStr,
      to: toStr,
      priorFrom: priorFromLabel,
      priorTo: priorToLabel,
      summary: {
        totalRevenue,
        orderCount,
        avgOrderValue:
          orderCount > 0
            ? Math.round((totalRevenue / orderCount) * 100) / 100
            : 0,
        shippingTotal,
        priorPeriodRevenue,
        trendPercent: trendPercent(totalRevenue, priorPeriodRevenue),
        currency: reportCurrency,
      },
      daily: dailyAgg,
      orders,
    };
  }

  private async sumShippingInRange(
    start: Date,
    end: Date,
    storeIds: Types.ObjectId[] | null,
  ): Promise<number> {
    const match: Record<string, unknown> = {
      createdAt: { $gte: start, $lt: end },
      status: { $in: ORDER_STATUSES_FOR_REVENUE },
    };
    if (storeIds?.length) {
      match.store = { $in: storeIds };
    }
    const agg = await this.orderModel
      .aggregate<{ total: number }>([
        { $match: match },
        {
          $group: {
            _id: null,
            total: {
              $sum: {
                $ifNull: [
                  '$shippingPrice',
                  { $ifNull: ['$shipping_price', 0] },
                ],
              },
            },
          },
        },
      ])
      .exec();
    const v = agg[0]?.total;
    return typeof v === 'number' && !Number.isNaN(v) ? v : 0;
  }

  private async aggregateDailyRevenue(
    start: Date,
    end: Date,
    storeIds: Types.ObjectId[] | null,
  ): Promise<FinancePeriodDailyPoint[]> {
    const match: Record<string, unknown> = {
      createdAt: { $gte: start, $lt: end },
      status: { $in: ORDER_STATUSES_FOR_REVENUE },
    };
    if (storeIds?.length) {
      match.store = { $in: storeIds };
    }
    const rows = await this.orderModel
      .aggregate<{
        _id: string;
        revenue: number;
        orderCount: number;
      }>([
        { $match: match },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt',
                timezone: PEAK_HOURS_TZ,
              },
            },
            revenue: {
              $sum: {
                $ifNull: ['$totalPrice', { $ifNull: ['$total_price', 0] }],
              },
            },
            orderCount: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .exec();
    const byDate = new Map(
      rows.map((r) => [
        r._id,
        {
          revenue: typeof r.revenue === 'number' ? r.revenue : 0,
          orderCount: typeof r.orderCount === 'number' ? r.orderCount : 0,
        },
      ]),
    );

    const out: FinancePeriodDailyPoint[] = [];
    let cursor = dayjs(start).tz(PEAK_HOURS_TZ).startOf('day');
    const endExclusive = dayjs(end).tz(PEAK_HOURS_TZ).startOf('day');

    while (cursor.isBefore(endExclusive)) {
      const key = cursor.format('YYYY-MM-DD');
      const hit = byDate.get(key);
      out.push({
        date: key,
        revenue: hit?.revenue ?? 0,
        orderCount: hit?.orderCount ?? 0,
      });
      cursor = cursor.add(1, 'day');
    }

    return out;
  }

  private async countOrdersInRange(
    start: Date,
    end: Date,
    storeIds: Types.ObjectId[] | null,
  ): Promise<number> {
    const match: Record<string, unknown> = {
      createdAt: { $gte: start, $lt: end },
      status: { $in: ORDER_STATUSES_FOR_REVENUE },
    };
    if (storeIds?.length) {
      match.store = { $in: storeIds };
    }
    return this.orderModel.countDocuments(match).exec();
  }

  private async weeklyCurrencyBreakdown(
    start: Date,
    end: Date,
    storeIds: Types.ObjectId[] | null,
  ): Promise<{
    total: number;
    orderCount: number;
    revenueByCurrency: Array<{ currency: string; amount: number }>;
    currency?: string;
    clientByUser: Map<string, Map<string, number>>;
    vendorByUser: Map<string, Map<string, number>>;
  }> {
    const match: Record<string, unknown> = {
      createdAt: { $gte: start, $lt: end },
      status: { $in: ORDER_STATUSES_FOR_REVENUE },
    };
    if (storeIds?.length) {
      match.store = { $in: storeIds };
    }
    const docs = await this.orderModel
      .find(match)
      .populate<{ store?: { owner?: Types.ObjectId; currency?: string } }>(
        'store',
        'owner currency',
      )
      .select('user store totalPrice currency stripeParentPaymentId')
      .lean()
      .exec();

    const stripeCurrencyBySessionId = await this.stripeCurrencyBySessionIds(
      docs.map((d) => String(d.stripeParentPaymentId ?? '')),
    );

    const revenueByCurrencyMap = new Map<string, number>();
    const clientByUser = new Map<string, Map<string, number>>();
    const vendorByUser = new Map<string, Map<string, number>>();

    for (const d of docs) {
      const currency = this.resolveDashboardOrderCurrency(
        {
          currency: d.currency,
          stripeParentPaymentId: d.stripeParentPaymentId,
          store: d.store,
        },
        stripeCurrencyBySessionId,
      );
      const amountRaw = Number(d.totalPrice);
      const amount = Number.isFinite(amountRaw) ? amountRaw : 0;
      pushCurrencyAmount(revenueByCurrencyMap, currency, amount);

      const userId = String(d.user ?? '').trim();
      if (userId) {
        const byCur = clientByUser.get(userId) ?? new Map<string, number>();
        pushCurrencyAmount(byCur, currency, amount);
        clientByUser.set(userId, byCur);
      }

      const ownerId = String(
        (d.store as { owner?: unknown } | undefined)?.owner ?? '',
      ).trim();
      if (ownerId) {
        const byCur = vendorByUser.get(ownerId) ?? new Map<string, number>();
        pushCurrencyAmount(byCur, currency, amount);
        vendorByUser.set(ownerId, byCur);
      }
    }

    const revenueByCurrency = breakdownFromCurrencyMap(revenueByCurrencyMap);
    const total = revenueByCurrency.reduce((acc, row) => acc + row.amount, 0);
    return {
      total,
      orderCount: docs.length,
      revenueByCurrency,
      currency: singleCurrencyFromBreakdown(revenueByCurrency),
      clientByUser,
      vendorByUser,
    };
  }

  private async aggregateWeeklyClientTotals(
    start: Date,
    end: Date,
    storeIds: Types.ObjectId[] | null,
    limit: number,
  ): Promise<
    {
      userId: string;
      orderCount: number;
      totalSpent: number;
      shippingTotal: number;
    }[]
  > {
    const match: Record<string, unknown> = {
      createdAt: { $gte: start, $lt: end },
      status: { $in: ORDER_STATUSES_FOR_REVENUE },
    };
    if (storeIds?.length) {
      match.store = { $in: storeIds };
    }
    const rows = await this.orderModel
      .aggregate<{
        _id: Types.ObjectId;
        orderCount: number;
        totalSpent: number;
        shippingTotal: number;
      }>([
        { $match: match },
        {
          $group: {
            _id: '$user',
            orderCount: { $sum: 1 },
            totalSpent: {
              $sum: {
                $ifNull: ['$totalPrice', { $ifNull: ['$total_price', 0] }],
              },
            },
            shippingTotal: {
              $sum: {
                $ifNull: [
                  '$shippingPrice',
                  { $ifNull: ['$shipping_price', 0] },
                ],
              },
            },
          },
        },
        { $sort: { totalSpent: -1 } },
        { $limit: limit },
      ])
      .exec();
    return rows.map((r) => ({
      userId: String(r._id),
      orderCount: r.orderCount ?? 0,
      totalSpent: r.totalSpent ?? 0,
      shippingTotal: r.shippingTotal ?? 0,
    }));
  }

  private async aggregateWeeklyVendorTotals(
    start: Date,
    end: Date,
    storeIds: Types.ObjectId[] | null,
    limit: number,
  ): Promise<
    {
      userId: string;
      orderCount: number;
      totalSpent: number;
      shippingTotal: number;
    }[]
  > {
    const match: Record<string, unknown> = {
      createdAt: { $gte: start, $lt: end },
      status: { $in: ORDER_STATUSES_FOR_REVENUE },
    };
    if (storeIds?.length) {
      match.store = { $in: storeIds };
    }
    const storeColl = this.storeModel.collection.name;
    const rows = await this.orderModel
      .aggregate<{
        _id: Types.ObjectId;
        orderCount: number;
        totalSpent: number;
        shippingTotal: number;
      }>([
        { $match: match },
        {
          $lookup: {
            from: storeColl,
            localField: 'store',
            foreignField: '_id',
            as: 'storeDoc',
          },
        },
        { $unwind: '$storeDoc' },
        {
          $group: {
            _id: '$storeDoc.owner',
            orderCount: { $sum: 1 },
            totalSpent: {
              $sum: {
                $ifNull: ['$totalPrice', { $ifNull: ['$total_price', 0] }],
              },
            },
            shippingTotal: {
              $sum: {
                $ifNull: [
                  '$shippingPrice',
                  { $ifNull: ['$shipping_price', 0] },
                ],
              },
            },
          },
        },
        { $sort: { totalSpent: -1 } },
        { $limit: limit },
      ])
      .exec();
    return rows
      .filter((r) => r._id != null)
      .map((r) => ({
        userId: String(r._id),
        orderCount: r.orderCount ?? 0,
        totalSpent: r.totalSpent ?? 0,
        shippingTotal: r.shippingTotal ?? 0,
      }));
  }

  private async hydrateWeeklyPerformanceRows(
    rows: {
      userId: string;
      orderCount: number;
      totalSpent: number;
      shippingTotal: number;
    }[],
    priorMap: Map<string, number>,
  ): Promise<FinanceWeeklyUserPerformanceRow[]> {
    if (!rows.length) return [];
    const ids = rows
      .map((r) => r.userId)
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    const users = await this.userModel
      .find({ _id: { $in: ids } })
      .select('fullName email')
      .lean()
      .exec();
    const userById = new Map(
      users.map((u) => {
        const id = (u as { _id?: unknown })._id;
        return [
          id != null ? String(id) : '',
          u as { fullName?: string; email?: string },
        ];
      }),
    );
    return rows.map((r) => {
      const u = userById.get(r.userId);
      const priorTotalSpent = priorMap.get(r.userId) ?? 0;
      return {
        userId: r.userId,
        fullName: String(u?.fullName ?? '—'),
        email: String(u?.email ?? '—'),
        orderCount: r.orderCount,
        totalSpent: r.totalSpent,
        avgOrderValue:
          r.orderCount > 0
            ? Math.round((r.totalSpent / r.orderCount) * 100) / 100
            : 0,
        shippingTotal: r.shippingTotal,
        priorTotalSpent,
        trendPercent: trendPercent(r.totalSpent, priorTotalSpent),
      };
    });
  }
}
