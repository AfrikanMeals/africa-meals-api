import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
/** dayjs est en CJS ; sans `esModuleInterop`, `import dayjs from 'dayjs'` vaut `undefined` au runtime. */
import dayjs = require('dayjs');
import utc = require('dayjs/plugin/utc');
import timezone = require('dayjs/plugin/timezone');
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { ProductModel } from '@schemas/product.schema';
import { ProductRatingModel } from '@schemas/product_rating.schema';
import {
  DeliveryDriverModel,
  DeliveryDriverStatutEnum,
} from '@schemas/delivery-driver.schema';
import { AddressModel } from '@schemas/address.schema';
import { StockItemModel, StockStatutEnum } from '@schemas/stock-item.schema';
import { StoreModel } from '@schemas/store.schema';
import { StoreRatingModel } from '@schemas/store_rating.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { CreateDashboardLivreurDto } from './dto/create-dashboard-livreur.dto';
import { AssignDashboardOrderDto } from './dto/assign-dashboard-order.dto';
import {
  coordsFromLngLat,
  lngLatFromPercentCoords,
  randomLngLatInBbox,
  randomLngLatNearPoint,
  randomPercentCoords,
} from './delivery-driver-geo';
import { NotificationsService } from '@modules/notifications/notifications.service';

dayjs.extend(utc);
dayjs.extend(timezone);

/** Objectif CA jour (KPI admin) — même unité que `total_price` commandes. */
const ADMIN_REVENUE_TARGET_FCFA = 500_000;
/** Objectif mensuel carte « Chiffre d’affaires » (unité = `total_price`, affiché $ CA côté UI). */
const DASHBOARD_CA_MONTHLY_TARGET_ADMIN = 500_000;
const DASHBOARD_CA_MONTHLY_TARGET_VENDOR = 50_000;
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
  avatar: string;
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
};

type DeliveryDriverLean = {
  _id: Types.ObjectId;
  store?: Types.ObjectId;
  nom: string;
  avatar: string;
  tel: string;
  statut: DeliveryDriverStatutEnum;
  zone: string;
  vehicule: DashboardLivreurRow['vehicule'];
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
  longitude?: number;
  latitude?: number;
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
export type DashboardVendorRecentCustomerRow = {
  userId: string;
  fullName: string;
  profileImage: string | null;
  lastOrderAt: string;
  isFirstOrderAtStore: boolean;
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
    @InjectModel(DeliveryDriverModel.name)
    private readonly deliveryDriverModel: Model<DeliveryDriverModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    private readonly notificationsService: NotificationsService,
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

  private storeNameForOrderPush(order: { store?: unknown }): string | undefined {
    const s = order.store;
    if (s && typeof s === 'object' && s !== null && 'name' in s) {
      const n = String((s as { name?: string }).name ?? '').trim();
      return n || undefined;
    }
    return undefined;
  }

  /**
   * Heures d’activité (0–23 h, fuseau `America/Toronto`, **30 derniers jours** glissants) :
   * - **commandes** : heure de `createdAt` (hors annulées)
   * - **livraisons** : heure de `updatedAt` pour statuts expédié / livré
   * La courbe affiche la somme des deux (`cmd`).
   */
  async listPeakHoursActivity(user: UserModel): Promise<DashboardPeakHourRow[]> {
    if (
      user.type !== UserTypeEnum.VENDOR &&
      user.type !== UserTypeEnum.ADMIN
    ) {
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
                      $in: [
                        OrderStatusEnum.SHIPPED,
                        OrderStatusEnum.COMPLETED,
                      ],
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
                      $in: [
                        OrderStatusEnum.SHIPPED,
                        OrderStatusEnum.COMPLETED,
                      ],
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
    const productById = new Map<
      string,
      { title: string; price: number }
    >();
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
      const items = (ord as { items?: Array<{ label?: string; quantity?: number; price?: number }> }).items ?? [];
      for (const it of items) {
        const lc = String(it.label ?? '')
          .trim()
          .toLowerCase();
        if (!lc) continue;
        const pidObj = titleLcToProductId.get(lc);
        if (!pidObj) continue;
        const pid = String(pidObj);
        const q =
          typeof it.quantity === 'number' && it.quantity > 0
            ? it.quantity
            : 1;
        const line = (Number(it.price) || 0) * q;
        const cur = byProduct.get(pid) ?? { commandes: 0, revenu: 0 };
        cur.commandes += q;
        cur.revenu += line;
        byProduct.set(pid, cur);
      }
    }

    const productObjectIds = products.map((p) => p._id as Types.ObjectId);
    type RatingAgg = { _id: Types.ObjectId; avgRate: number; ratingCount: number };
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

    const ratingByProduct = new Map<
      string,
      { avg: number; count: number }
    >();
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
    if (
      user.type !== UserTypeEnum.VENDOR &&
      user.type !== UserTypeEnum.ADMIN
    ) {
      return [];
    }

    const z = PEAK_HOURS_TZ;
    const startToday = dayjs().tz(z).startOf('day').toDate();
    const endToday = dayjs().tz(z).endOf('day').toDate();
    const startYesterday = dayjs().tz(z).subtract(1, 'day').startOf('day').toDate();
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
        const lc = String(p.title ?? '').trim().toLowerCase();
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

    const bump = (map: Map<string, Agg>, lc: string, raw: string, q: number) => {
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
    annulees: number;
  }> {
    const empty = {
      total: 0,
      livrees: 0,
      enLivraison: 0,
      enAttente: 0,
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
        (user as UserModel & { _id?: Types.ObjectId | string })._id ??
        user.id;
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
        default:
          enAttente += n;
      }
    }

    const total = livrees + enLivraison + enAttente + annulees;
    return { total, livrees, enLivraison, enAttente, annulees };
  }

  /**
   * Avis sur les plats (collection `product_ratings`) : client auteur, plat, restaurant (boutique du plat).
   * Vendeur : uniquement les avis dont le plat appartient à l’une de ses boutiques.
   */
  async getProductReviewsDashboard(
    user: UserModel,
  ): Promise<DashboardProductReviewsPayload> {
    if (
      user.type !== UserTypeEnum.ADMIN &&
      user.type !== UserTypeEnum.VENDOR
    ) {
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
      !vendorIds?.length ||
      vendorIds.some((id) => id.toString() === storeId);

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

  /**
   * Chiffre d’affaires **mois civil en cours** (America/Toronto) vs **même nombre de jours**
   * le mois précédent — pour la tendance %.
   * Admin : toutes les boutiques ; vendeur : ses boutiques uniquement.
   */
  async getDashboardRevenueSummary(
    user: UserModel,
  ): Promise<DashboardRevenueSummary> {
    const empty = (
      target: number,
    ): DashboardRevenueSummary => ({
      revenueMonthToDate: 0,
      revenueComparablePriorMonth: 0,
      trendPercent: null,
      monthlyTarget: target,
    });

    if (
      user.type !== UserTypeEnum.ADMIN &&
      user.type !== UserTypeEnum.VENDOR
    ) {
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

    const [mtd, cmp] = await Promise.all([
      this.sumRevenueInRange(monthStart, monthEndExclusive, storeIds),
      this.sumRevenueInRange(
        prevMonthStart,
        prevComparableEndExclusive,
        storeIds,
      ),
    ]);

    return {
      revenueMonthToDate: mtd,
      revenueComparablePriorMonth: cmp,
      trendPercent: trendPercent(mtd, cmp),
      monthlyTarget:
        user.type === UserTypeEnum.ADMIN
          ? DASHBOARD_CA_MONTHLY_TARGET_ADMIN
          : DASHBOARD_CA_MONTHLY_TARGET_VENDOR,
    };
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
            total: { $sum: { $ifNull: ['$total_price', 0] } },
          },
        },
      ])
      .exec();
    const v = agg[0]?.total;
    return typeof v === 'number' && !Number.isNaN(v) ? v : 0;
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
      const rows = await this.deliveryDriverModel
        .find({ store: { $in: ids } })
        .sort({ nom: 1 })
        .lean()
        .exec();
      const fromFleet = rows.map((r) =>
        this.toDashboardLivreurRow(r as unknown as DeliveryDriverLean),
      );
      const fromAccounts = await this.listRegionalDeliveryUsersAsRows(
        storePoints,
        REGION_DELIVERY_USERS_RADIUS_KM,
      );
      const merged = [...fromFleet, ...fromAccounts];
      merged.sort((a, b) =>
        a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }),
      );
      return merged;
    }
    if (user.type === UserTypeEnum.ADMIN) {
      const rows = await this.deliveryDriverModel
        .find({})
        .sort({ nom: 1 })
        .lean()
        .exec();
      return rows.map((r) =>
        this.toDashboardLivreurRow(r as unknown as DeliveryDriverLean),
      );
    }
    throw new ForbiddenException('livreurs_access_denied');
  }

  async createDashboardLivreur(
    user: UserModel,
    dto: CreateDashboardLivreurDto,
  ): Promise<DashboardLivreurRow> {
    if (
      user.type !== UserTypeEnum.ADMIN &&
      user.type !== UserTypeEnum.VENDOR
    ) {
      throw new ForbiddenException('livreurs_access_denied');
    }
    const immat =
      dto.immat !== undefined && dto.immat.trim() !== ''
        ? dto.immat.trim()
        : '—';
    const capacite =
      dto.vehicule === 'Voiture' ? 4 : dto.vehicule === 'Vélo' ? 1 : 2;
    const { storeId, storeLean } = await this.resolveStoreForLivreurCreation(
      user,
      dto.storeId,
    );
    const { longitude, latitude } =
      this.pickInitialLngLatFromStoreLean(storeLean);
    const coords = randomPercentCoords();
    const created = await this.deliveryDriverModel.create({
      store: storeId,
      nom: dto.nom.trim(),
      avatar: dto.avatar,
      tel: dto.tel.trim(),
      zone: dto.zone.trim(),
      vehicule: dto.vehicule,
      immat,
      statut: DeliveryDriverStatutEnum.DISPONIBLE,
      note: 4.5,
      livraisons_jour: 0,
      livraisons_total: 0,
      temps_moyen: 25,
      distance_jour: 0,
      revenu_jour: 0,
      capacite,
      commande_en_cours: null,
      coords,
      longitude,
      latitude,
    });
    return this.toDashboardLivreurRow(
      created.toObject() as unknown as DeliveryDriverLean,
    );
  }

  async assignOrderToLivreur(
    user: UserModel,
    dto: AssignDashboardOrderDto,
  ): Promise<DashboardLivreurRow> {
    if (user.type !== UserTypeEnum.ADMIN && user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('livreurs_access_denied');
    }
    if (
      !Types.ObjectId.isValid(dto.livreurId) ||
      !Types.ObjectId.isValid(dto.orderId)
    ) {
      throw new BadRequestException('invalid_ids');
    }

    const livreurId = new Types.ObjectId(dto.livreurId);
    const orderId = new Types.ObjectId(dto.orderId);
    const vendorStoreIds =
      user.type === UserTypeEnum.VENDOR ? vendorStoreObjectIds(user) : null;
    if (user.type === UserTypeEnum.VENDOR && !vendorStoreIds?.length) {
      throw new ForbiddenException('vendor_no_store');
    }

    const livreurDoc = await this.deliveryDriverModel.findById(livreurId).exec();
    if (!livreurDoc) throw new NotFoundException('livreur_not_found');
    const livreurStoreId = livreurDoc.store ? String(livreurDoc.store) : '';
    if (vendorStoreIds?.length) {
      if (!vendorStoreIds.some((s) => s.toString() === livreurStoreId)) {
        throw new ForbiddenException('store_forbidden');
      }
    }
    if (
      livreurDoc.statut !== DeliveryDriverStatutEnum.DISPONIBLE ||
      livreurDoc.commande_en_cours
    ) {
      throw new BadRequestException('livreur_not_available');
    }

    const orderDoc = await this.orderModel
      .findById(orderId)
      .populate('store', 'name')
      .populate({
        path: 'user',
        select: 'fullName addresses',
        populate: { path: 'addresses' },
      })
      .exec();
    if (!orderDoc) throw new NotFoundException('order_not_found');
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
    if (livreurStoreId && orderStoreId && livreurStoreId !== orderStoreId) {
      throw new BadRequestException('store_mismatch');
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

    const userAny = orderDoc.user as
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
    const tail = String(orderDoc._id).slice(-6).toUpperCase();

    livreurDoc.statut = DeliveryDriverStatutEnum.EN_LIVRAISON;
    livreurDoc.commande_en_cours = {
      id: `#AE-${tail}`,
      client: clientName,
      adresse: adresse || '—',
      eta: '30 min',
    };
    await livreurDoc.save();

    const prevOrderStatus = orderDoc.status as OrderStatusEnum;
    orderDoc.status = OrderStatusEnum.SHIPPED;
    await orderDoc.save();

    const customerId = this.customerUserIdForOrderPush(orderDoc);
    if (customerId && prevOrderStatus !== OrderStatusEnum.SHIPPED) {
      void this.notificationsService
        .pushCustomerOrderStatusChanged({
          userId: customerId,
          orderId: orderDoc._id.toString(),
          storeName: this.storeNameForOrderPush(orderDoc),
          previousStatus: prevOrderStatus,
          newStatus: OrderStatusEnum.SHIPPED,
        })
        .catch((err) => {
          this.logger.warn(
            `FCM order shipped: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
    }

    return this.toDashboardLivreurRow(
      livreurDoc.toObject() as unknown as DeliveryDriverLean,
    );
  }

  async updateDashboardLivreurStatut(
    user: UserModel,
    livreurId: string,
    statut: 'disponible' | 'hors_ligne',
  ): Promise<DashboardLivreurRow> {
    if (user.type !== UserTypeEnum.ADMIN && user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('livreurs_access_denied');
    }
    if (!Types.ObjectId.isValid(livreurId)) {
      throw new BadRequestException('invalid_livreur_id');
    }
    const vendorStoreIds =
      user.type === UserTypeEnum.VENDOR ? vendorStoreObjectIds(user) : null;
    if (user.type === UserTypeEnum.VENDOR && !vendorStoreIds?.length) {
      throw new ForbiddenException('vendor_no_store');
    }

    const oid = new Types.ObjectId(livreurId);
    const livreurDoc = await this.deliveryDriverModel.findById(oid).exec();
    if (!livreurDoc) throw new NotFoundException('livreur_not_found');
    const livreurStoreId = livreurDoc.store ? String(livreurDoc.store) : '';
    if (vendorStoreIds?.length) {
      if (!vendorStoreIds.some((s) => s.toString() === livreurStoreId)) {
        throw new ForbiddenException('store_forbidden');
      }
    }

    if (statut === 'hors_ligne') {
      livreurDoc.statut = DeliveryDriverStatutEnum.HORS_LIGNE;
      livreurDoc.commande_en_cours = null;
    } else {
      if (livreurDoc.statut !== DeliveryDriverStatutEnum.HORS_LIGNE) {
        throw new BadRequestException('livreur_reactivate_only_when_offline');
      }
      livreurDoc.statut = DeliveryDriverStatutEnum.DISPONIBLE;
    }
    await livreurDoc.save();
    return this.toDashboardLivreurRow(
      livreurDoc.toObject() as unknown as DeliveryDriverLean,
    );
  }

  private toDashboardLivreurRow(doc: DeliveryDriverLean): DashboardLivreurRow {
    const cmd = doc.commande_en_cours;
    const { longitude, latitude } = this.resolveLivreurLngLat(doc);
    return {
      id: String(doc._id),
      nom: doc.nom,
      avatar: doc.avatar,
      tel: doc.tel,
      statut: doc.statut as DashboardLivreurRow['statut'],
      zone: doc.zone,
      vehicule: doc.vehicule,
      immat: doc.immat,
      note: doc.note,
      livraisons_jour: doc.livraisons_jour,
      livraisons_total: doc.livraisons_total,
      temps_moyen: doc.temps_moyen,
      distance_jour: doc.distance_jour,
      revenu_jour: doc.revenu_jour,
      capacite: doc.capacite,
      commande_en_cours: cmd
        ? {
            id: cmd.id,
            client: cmd.client,
            adresse: cmd.adresse,
            eta: cmd.eta,
          }
        : null,
      coords: { x: doc.coords.x, y: doc.coords.y },
      longitude,
      latitude,
      storeId: doc.store != null ? String(doc.store) : '',
    };
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

  private async listRegionalDeliveryUsersAsRows(
    storePoints: VendorStorePoint[],
    radiusKm: number,
  ): Promise<DashboardLivreurRow[]> {
    if (!storePoints.length) return [];
    const radiusRad = radiusKm / EARTH_RADIUS_KM;
    const geoClauses = storePoints.map((p) => ({
      location: {
        $geoWithin: {
          $centerSphere: [[p.lng, p.lat], radiusRad],
        },
      },
    }));
    const nearAddresses = await this.addressModel
      .find({ $or: geoClauses })
      .select('_id')
      .lean()
      .exec();
    const addressIds = nearAddresses
      .map((a) => a._id)
      .filter((id) => id instanceof Types.ObjectId);
    if (!addressIds.length) return [];

    const users = await this.userModel
      .find({
        type: UserTypeEnum.DELIVERY,
        addresses: { $in: addressIds },
      })
      .populate({ path: 'addresses', select: 'isDefault city location' })
      .lean()
      .exec();

    const addressIdSet = new Set(addressIds.map((id) => String(id)));
    const rows: DashboardLivreurRow[] = [];

    for (const raw of users) {
      const u = raw as unknown as DeliveryUserLean;
      const addrs = (u.addresses ?? []).filter((a) =>
        addressIdSet.has(String(a._id)),
      );
      if (!addrs.length) continue;

      const withCoords = addrs.filter((a) => {
        const c = a.location?.coordinates;
        return (
          Array.isArray(c) &&
          c.length >= 2 &&
          !(Number(c[0]) === 0 && Number(c[1]) === 0)
        );
      });
      if (!withCoords.length) continue;

      const chosen =
        withCoords.find((a) => a.isDefault) ?? withCoords[0];
      if (!chosen) continue;
      const lng = Number(chosen.location!.coordinates![0]);
      const lat = Number(chosen.location!.coordinates![1]);

      let bestStoreId = storePoints[0]!.storeId;
      let bestKm = Number.POSITIVE_INFINITY;
      for (const sp of storePoints) {
        const d = haversineKm(lng, lat, sp.lng, sp.lat);
        if (d < bestKm) {
          bestKm = d;
          bestStoreId = sp.storeId;
        }
      }

      rows.push(
        this.toDashboardLivreurRowFromDeliveryUser(
          u,
          chosen.city?.trim() || '—',
          lng,
          lat,
          bestStoreId,
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
  ): DashboardLivreurRow {
    const coords = coordsFromLngLat(longitude, latitude);
    const avatar = u.profileImage?.trim() || '🛵';
    return {
      id: `dlusr_${String(u._id)}`,
      nom: u.fullName?.trim() || 'Livreur',
      avatar,
      tel: u.phoneNumber?.trim() || '—',
      statut: 'disponible',
      zone: `${cityLabel} · Inscrit`,
      vehicule: 'Moto',
      immat: '—',
      note: 0,
      livraisons_jour: 0,
      livraisons_total: 0,
      temps_moyen: 0,
      distance_jour: 0,
      revenu_jour: 0,
      capacite: 2,
      commande_en_cours: null,
      coords,
      longitude,
      latitude,
      storeId: nearestStoreId,
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

  private resolveLivreurLngLat(doc: DeliveryDriverLean): {
    longitude: number;
    latitude: number;
  } {
    if (
      typeof doc.longitude === 'number' &&
      !Number.isNaN(doc.longitude) &&
      typeof doc.latitude === 'number' &&
      !Number.isNaN(doc.latitude)
    ) {
      return { longitude: doc.longitude, latitude: doc.latitude };
    }
    return lngLatFromPercentCoords(doc.coords);
  }
}
