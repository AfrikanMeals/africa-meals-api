import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { SharedRedisService } from '@common/redis/shared-redis.service';
import {
  agentHasDeliveryCapacity,
  maxConcurrentOrdersFromApplication,
} from '@modules/delivery-agent/delivery-agent-capacity.util';
import { CourierPerformanceStatsService } from '@modules/delivery-agent/courier-performance-stats.service';
import { CourierGeoService } from '@modules/fleet/courier-geo.service';
import { COURIER_GEO_DEFAULT_RADIUS_KM } from '@modules/fleet/courier-geo.constants';
import { MailerService } from '@modules/mailer/mailer.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { PlatformShippingSettingsService } from '@modules/platform-shipping-settings/platform-shipping-settings.service';
import {
  rankDeliveryOfferCandidates,
  type DeliveryOfferCandidateInput,
} from '@modules/delivery-order-offer/delivery-order-offer.ranking';
import { StoreDeliveryDriversService } from '@modules/store-delivery-drivers/store-delivery-drivers.service';
import {
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationStatus,
} from '@schemas/delivery-agent-application.schema';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import {
  StoreDeliveryAssignmentModeEnum,
  StoreModel,
} from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { resolveOrderOperatingRegionCode } from '@modules/supported-countries/region-tax.util';

const NOTIFIED_REDIS_PREFIX = 'delivery:marketplace:notified:';
const CLAIM_GUARD_REDIS_PREFIX = 'delivery:marketplace:claim-guard:';
/** TTL set notifiés (2h) — pour fan-out « pris par un autre ». */
const NOTIFIED_TTL_SEC = 2 * 60 * 60;
/** Fenêtre soft guard après claim (autres peuvent encore tenter — serveur refuse si déjà pris). */
const CLAIM_GUARD_TTL_SEC = 45;

export type MarketplaceNotifyResult = {
  notified: number;
  skippedReason?: string;
};

/**
 * Fan-out push + email aux livreurs proches quand une course entre en file ouverte.
 * Ranking : distance + charge + acceptance rate + performance.
 */
@Injectable()
export class CourierMarketplaceDispatchService {
  private readonly logger = new Logger(CourierMarketplaceDispatchService.name);

  constructor(
    @InjectModel(OrderModel.name) private readonly _orders: Model<OrderModel>,
    @InjectModel(StoreModel.name) private readonly _stores: Model<StoreModel>,
    @InjectModel(DeliveryAgentApplicationModel.name)
    private readonly _applications: Model<DeliveryAgentApplicationModel>,
    @InjectModel(UserModel.name) private readonly _users: Model<UserModel>,
    private readonly _courierGeo: CourierGeoService,
    private readonly _perf: CourierPerformanceStatsService,
    private readonly _notifications: NotificationsService,
    private readonly _mailer: MailerService,
    private readonly _storeDrivers: StoreDeliveryDriversService,
    private readonly _platformShipping: PlatformShippingSettingsService,
    private readonly _config: ConfigService,
    private readonly _redis: SharedRedisService,
  ) {}

  /**
   * Après mark-ready / cascade épuisée : notifie le pool marketplace si applicable.
   */
  async notifyClaimableOrder(
    order: OrderModel | Record<string, unknown>,
  ): Promise<MarketplaceNotifyResult> {
    try {
      const orderId =
        (order as { _id?: Types.ObjectId })._id?.toString() ??
        String((order as { id?: string }).id ?? '');
      if (!orderId || !Types.ObjectId.isValid(orderId)) {
        return { notified: 0, skippedReason: 'invalid_order' };
      }

      const fresh = await this._orders
        .findById(new Types.ObjectId(orderId))
        .select(
          'status shouldShip assignedDeliveryUser activeDeliveryOfferId store storeRegionCode taxCountryCode deliveryAddressSnapshot shippingPrice',
        )
        .lean()
        .exec();
      if (!fresh) return { notified: 0, skippedReason: 'not_found' };
      if (fresh.shouldShip !== true) {
        return { notified: 0, skippedReason: 'not_shippable' };
      }
      if (fresh.assignedDeliveryUser) {
        return { notified: 0, skippedReason: 'already_assigned' };
      }
      // Fan-out marketplace seulement après mark-ready (approved).
      if (fresh.status !== OrderStatusEnum.APPROVED) {
        return { notified: 0, skippedReason: 'status' };
      }
      if ((fresh as { activeDeliveryOfferId?: unknown }).activeDeliveryOfferId) {
        return { notified: 0, skippedReason: 'exclusive_offer_active' };
      }

      const storeId = this.storeIdFromOrder(fresh);
      if (!storeId) return { notified: 0, skippedReason: 'no_store' };

      const store = await this._stores
        .findById(new Types.ObjectId(storeId))
        .select(
          'name vendorManagesDeliveryDrivers deliveryAssignmentMode address region',
        )
        .populate('address', 'location')
        .lean()
        .exec();
      if (!store) return { notified: 0, skippedReason: 'store_missing' };

      if (this._storeDrivers.isStoreManagedDelivery(store)) {
        const mode = this._storeDrivers.storeAssignmentMode(store);
        // MANUAL : pas de fan-out marketplace. AUTO hard-assign : skip si déjà assigné
        // (appelé après cascade fallback ou sans assignee).
        if (mode === StoreDeliveryAssignmentModeEnum.MANUAL) {
          return { notified: 0, skippedReason: 'manual_assignment' };
        }
        if (mode === StoreDeliveryAssignmentModeEnum.AUTO) {
          const assigned = (fresh as { assignedDeliveryUser?: unknown })
            .assignedDeliveryUser;
          if (assigned) {
            return { notified: 0, skippedReason: 'already_assigned_auto' };
          }
        }
        // SEMI_AUTO + flotte : cascade exclusive jusqu’à exhaustion ; ici = absente / épuisée.
      }

      const storeLngLat = this.storeLngLatFromDoc(
        store as Record<string, unknown>,
      );
      if (!storeLngLat) {
        return { notified: 0, skippedReason: 'store_no_geo' };
      }

      const regionCode =
        resolveOrderOperatingRegionCode(fresh as Record<string, unknown>) ??
        (typeof (store as { region?: string }).region === 'string'
          ? String((store as { region?: string }).region)
          : undefined);

      const shipping = await this._platformShipping.getPublicSettings(
        regionCode,
      );
      const radiusKm = Math.max(
        1,
        Math.min(
          80,
          Number(shipping.maxDeliveryRadiusKm) || COURIER_GEO_DEFAULT_RADIUS_KM,
        ),
      );
      const notifyLimit = this.notifyLimit();

      let nearby = await this._courierGeo.searchNearby({
        latitude: storeLngLat[1],
        longitude: storeLngLat[0],
        radiusKm,
        limit: Math.max(notifyLimit * 3, 40),
      });

      // Fallback Mongo GPS si Redis GEO vide.
      if (nearby.length === 0) {
        nearby = await this.fallbackNearbyFromMongo({
          storeLngLat,
          radiusKm,
          regionCode,
          limit: Math.max(notifyLimit * 3, 40),
        });
      }

      if (nearby.length === 0) {
        return { notified: 0, skippedReason: 'no_nearby_couriers' };
      }

      const candidateIds = nearby.map((h) => h.agentUserId);
      const apps = await this._applications
        .find({
          user: {
            $in: candidateIds.map((id) => new Types.ObjectId(id)),
          },
          status: DeliveryAgentApplicationStatus.APPROVED,
          dashboardAvailability: { $ne: 'hors_ligne' },
        })
        .select(
          'user dashboardAvailability maxConcurrentOrders lastLatitude lastLongitude region',
        )
        .lean()
        .exec();

      const appByUser = new Map(
        apps.map((a) => [String((a as { user?: unknown }).user), a]),
      );

      const perfByUser = await this._perf.getMany(candidateIds);
      const geoByUser = new Map(
        nearby.map((h) => [h.agentUserId, h.distanceMeters]),
      );

      const inputs: DeliveryOfferCandidateInput[] = [];
      for (const uid of candidateIds) {
        const app = appByUser.get(uid);
        if (!app) continue;
        const agentRegion = String(
          (app as { region?: string }).region ?? '',
        )
          .trim()
          .toUpperCase();
        if (
          regionCode &&
          agentRegion &&
          agentRegion !== String(regionCode).trim().toUpperCase()
        ) {
          continue;
        }
        const capacity = await agentHasDeliveryCapacity(
          this._orders,
          app,
          new Types.ObjectId(uid),
        );
        if (!capacity.allowed) continue;

        const perf = perfByUser.get(uid);
        inputs.push({
          agentUserId: uid,
          dashboardAvailability:
            (app as { dashboardAvailability?: string }).dashboardAvailability ??
            null,
          activeOrderCount: capacity.activeCount,
          maxConcurrentOrders:
            capacity.capacity || maxConcurrentOrdersFromApplication(app),
          lastLatitude: (app as { lastLatitude?: number }).lastLatitude ?? null,
          lastLongitude:
            (app as { lastLongitude?: number }).lastLongitude ?? null,
          geoDistanceMeters: geoByUser.get(uid) ?? null,
          acceptanceRate: perf?.acceptanceRate ?? null,
          performanceScore: perf?.performanceScore ?? 70,
        });
      }

      const ranked = rankDeliveryOfferCandidates(inputs, storeLngLat);
      const top = ranked.slice(0, notifyLimit);
      if (top.length === 0) {
        return { notified: 0, skippedReason: 'no_eligible_after_rank' };
      }

      const storeName =
        String((store as { name?: string }).name ?? '').trim() || 'Restaurant';
      const orderRef = `#AE-${orderId.slice(-6).toUpperCase()}`;
      const already = await this.getNotifiedAgentIds(orderId);
      let notified = 0;

      for (const row of top) {
        if (already.has(row.agentUserId)) continue;
        const ok = await this.notifyOneAgent({
          agentUserId: row.agentUserId,
          orderId,
          orderRef,
          storeId,
          storeName,
          distanceMeters: row.distanceMeters,
        });
        if (ok) {
          notified += 1;
          already.add(row.agentUserId);
          void this._perf.recordMarketplaceNotified(row.agentUserId);
        }
      }

      if (already.size > 0) {
        await this.saveNotifiedAgentIds(orderId, [...already]);
      }

      this.logger.log(
        `marketplace notify order=${orderId} notified=${notified} candidates=${ranked.length}`,
      );
      return { notified };
    } catch (e) {
      this.logger.warn(
        `notifyClaimableOrder failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return { notified: 0, skippedReason: 'error' };
    }
  }

  /**
   * Après claim réussi : retire la course des autres notifiés (push) + soft guard Redis.
   * Les autres peuvent encore tenter claim (garde atomique serveur) « just in case ».
   */
  async onOrderClaimedByCourier(args: {
    orderId: string;
    winnerAgentUserId: string;
    storeName?: string;
    orderRef?: string;
  }): Promise<void> {
    const orderId = String(args.orderId ?? '').trim();
    const winner = String(args.winnerAgentUserId ?? '').trim();
    if (!orderId || !winner) return;

    try {
      await this.setClaimGuard(orderId, winner);

      const notified = await this.getNotifiedAgentIds(orderId);
      const others = [...notified].filter((id) => id !== winner);
      if (others.length === 0) return;

      const store =
        (args.storeName ?? '').trim() || 'Restaurant';
      const ref =
        (args.orderRef ?? '').trim() ||
        `#AE-${orderId.slice(-6).toUpperCase()}`;

      await Promise.all(
        others.map((agentUserId) =>
          this._notifications.notifyCourierOrderClaimedByOther({
            recipientUserId: agentUserId,
            orderId,
            orderRef: ref,
            storeName: store,
            claimedByUserId: winner,
            softGuardSec: CLAIM_GUARD_TTL_SEC,
          }),
        ),
      );

      void this._perf.recordMarketplaceMissed(others);
    } catch (e) {
      this.logger.warn(
        `onOrderClaimedByCourier: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  /** Soft guard : true si un autre livreur a claim récemment (UI peut afficher « pris »). */
  async getClaimGuardWinner(orderId: string): Promise<string | null> {
    const redis = await this.redisClient();
    if (!redis) return null;
    try {
      const v = await redis.get(`${CLAIM_GUARD_REDIS_PREFIX}${orderId}`);
      return v?.trim() || null;
    } catch {
      return null;
    }
  }

  private async notifyOneAgent(args: {
    agentUserId: string;
    orderId: string;
    orderRef: string;
    storeId: string;
    storeName: string;
    distanceMeters: number | null;
  }): Promise<boolean> {
    try {
      await this._notifications.notifyCourierMarketplaceAvailable({
        recipientUserId: args.agentUserId,
        orderId: args.orderId,
        orderRef: args.orderRef,
        storeName: args.storeName,
        storeId: args.storeId,
        distanceMeters: args.distanceMeters,
      });

      const user = await this._users
        .findById(new Types.ObjectId(args.agentUserId))
        .select('email fullName type')
        .lean()
        .exec();
      const email = String((user as { email?: string } | null)?.email ?? '').trim();
      if (email && (user as { type?: string })?.type === UserTypeEnum.DELIVERY) {
        const name =
          String((user as { fullName?: string }).fullName ?? '').trim() ||
          'Livreur';
        const appName = this._config.get<string>('APP_NAME') ?? 'Afrika Meals';
        const distLabel =
          args.distanceMeters != null
            ? ` (~${(args.distanceMeters / 1000).toFixed(1)} km)`
            : '';
        const subject = `${appName} — Nouvelle course disponible${distLabel}`;
        const html = [
          `<p>Bonjour <strong>${this.escapeHtml(name)}</strong>,</p>`,
          `<p>Une nouvelle course <strong>${this.escapeHtml(args.orderRef)}</strong> est disponible près de vous chez <strong>${this.escapeHtml(args.storeName)}</strong>${this.escapeHtml(distLabel)}.</p>`,
          `<p>Ouvrez l’app livreur pour accepter la course. Si un autre livreur la prend avant vous, vous pourrez encore tenter (le serveur confirmera).</p>`,
        ].join('\n');
        const text = [
          `Bonjour ${name},`,
          ``,
          `Nouvelle course ${args.orderRef} disponible chez ${args.storeName}${distLabel}.`,
          `Ouvrez l’app livreur pour accepter.`,
        ].join('\n');
        void this._mailer
          .sendSimple({
            to: email,
            toName: name,
            subject,
            html,
            text,
            logContext: 'courier-marketplace-available',
          })
          .catch((err) =>
            this.logger.warn(
              `marketplace email agent=${args.agentUserId}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            ),
          );
      }
      return true;
    } catch (e) {
      this.logger.warn(
        `notifyOneAgent ${args.agentUserId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return false;
    }
  }

  private async fallbackNearbyFromMongo(args: {
    storeLngLat: [number, number];
    radiusKm: number;
    regionCode?: string;
    limit: number;
  }): Promise<Array<{ agentUserId: string; distanceMeters: number }>> {
    const filter: Record<string, unknown> = {
      status: DeliveryAgentApplicationStatus.APPROVED,
      dashboardAvailability: { $ne: 'hors_ligne' },
      lastLatitude: { $type: 'number' },
      lastLongitude: { $type: 'number' },
    };
    if (args.regionCode) {
      filter.region = String(args.regionCode).trim().toUpperCase();
    }
    const apps = await this._applications
      .find(filter)
      .select('user lastLatitude lastLongitude')
      .limit(200)
      .lean()
      .exec();

    const { haversineMeters } = await import(
      '@modules/delivery-order-offer/delivery-order-offer.ranking'
    );
    const maxM = args.radiusKm * 1000;
    const hits: Array<{ agentUserId: string; distanceMeters: number }> = [];
    for (const app of apps) {
      const uid = String((app as { user?: unknown }).user ?? '');
      const lat = Number((app as { lastLatitude?: number }).lastLatitude);
      const lng = Number((app as { lastLongitude?: number }).lastLongitude);
      if (!uid || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const meters = Math.round(
        haversineMeters(args.storeLngLat, [lng, lat]),
      );
      if (meters > maxM) continue;
      hits.push({ agentUserId: uid, distanceMeters: meters });
    }
    hits.sort((a, b) => a.distanceMeters - b.distanceMeters);
    return hits.slice(0, args.limit);
  }

  private notifyLimit(): number {
    const raw = Number(
      this._config.get<string>('DELIVERY_MARKETPLACE_NOTIFY_LIMIT') ?? 12,
    );
    if (!Number.isFinite(raw) || raw < 1) return 12;
    return Math.min(40, Math.trunc(raw));
  }

  private async redisClient() {
    await this._redis.ensureConnected();
    return this._redis.getClient();
  }

  private async getNotifiedAgentIds(orderId: string): Promise<Set<string>> {
    const redis = await this.redisClient();
    if (!redis) return new Set();
    try {
      const members = await redis.smembers(`${NOTIFIED_REDIS_PREFIX}${orderId}`);
      return new Set(
        (members ?? []).map((m) => String(m).trim()).filter(Boolean),
      );
    } catch {
      return new Set();
    }
  }

  private async saveNotifiedAgentIds(
    orderId: string,
    agentIds: string[],
  ): Promise<void> {
    const redis = await this.redisClient();
    if (!redis || agentIds.length === 0) return;
    const key = `${NOTIFIED_REDIS_PREFIX}${orderId}`;
    try {
      await redis.sadd(key, ...agentIds);
      await redis.expire(key, NOTIFIED_TTL_SEC);
    } catch {
      /* ignore */
    }
  }

  private async setClaimGuard(
    orderId: string,
    winnerAgentUserId: string,
  ): Promise<void> {
    const redis = await this.redisClient();
    if (!redis) return;
    try {
      await redis.set(
        `${CLAIM_GUARD_REDIS_PREFIX}${orderId}`,
        winnerAgentUserId,
        'EX',
        CLAIM_GUARD_TTL_SEC,
      );
    } catch {
      /* ignore */
    }
  }

  private storeIdFromOrder(
    order: OrderModel | Record<string, unknown>,
  ): string | undefined {
    const store = (order as { store?: unknown }).store;
    if (store && typeof store === 'object' && store !== null && '_id' in store) {
      return String((store as { _id: unknown })._id);
    }
    if (store != null && Types.ObjectId.isValid(String(store))) {
      return String(store);
    }
    return undefined;
  }

  private storeLngLatFromDoc(
    store: Record<string, unknown> | null | undefined,
  ): [number, number] | null {
    if (!store) return null;
    const addr = store.address;
    if (!addr || typeof addr !== 'object') return null;
    const loc = (addr as { location?: { coordinates?: number[] } }).location;
    const coords = loc?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return [lng, lat];
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
