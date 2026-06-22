import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { StoreDeliveryDriversService } from '@modules/store-delivery-drivers/store-delivery-drivers.service';
import { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';
import {
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationStatus,
} from '@schemas/delivery-agent-application.schema';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { StoreModel } from '@schemas/store.schema';
import { haversineDistance } from 'src/utils/helpers';
import { Model, Types } from 'mongoose';

/** Même rayon que le tableau de bord vendeur (`listApprovedDeliveryUsersForDashboard`). */
export const FLEET_PLATFORM_STORE_RADIUS_KM = 75;

type GeoStore = {
  storeId: string;
  lng: number;
  lat: number;
  platformPool: boolean;
};

@Injectable()
export class FleetAudienceService {
  private geoStoreCache: { at: number; rows: GeoStore[] } | null = null;
  private readonly geoStoreCacheTtlMs = 60_000;

  constructor(
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    @InjectModel(DeliveryAgentApplicationModel.name)
    private readonly applications: Model<DeliveryAgentApplicationModel>,
    @InjectModel(OrderModel.name)
    private readonly orders: Model<OrderModel>,
    private readonly storeDeliveryDrivers: StoreDeliveryDriversService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  /**
   * Boutiques à notifier en WS/SSE pour un livreur :
   * - flotte restaurant (membership active)
   * - boutiques des commandes expédiées en cours
   * - boutiques « pool plateforme » dans le rayon GPS (livreurs fournis par la plateforme)
   */
  async resolveNotifyStoreIds(agentUserId: string): Promise<string[]> {
    const uid = agentUserId.trim();
    if (!uid || !Types.ObjectId.isValid(uid)) return [];

    const out = new Set<string>(
      await this.storeDeliveryDrivers.listStoreIdsForActiveDriver(uid),
    );

    const agentOid = new Types.ObjectId(uid);

    const activeOrders = await this.orders
      .find({
        assigned_delivery_user: agentOid,
        shouldShip: true,
        status: OrderStatusEnum.SHIPPED,
      })
      .select('store')
      .lean()
      .exec();
    for (const order of activeOrders) {
      const storeId = String((order as { store?: unknown }).store ?? '').trim();
      if (Types.ObjectId.isValid(storeId)) out.add(storeId);
    }

    const coords = await this.resolveAgentCoordinates(uid);
    if (!coords) return [...out];

    const geoStores = await this.loadGeoStores();
    for (const row of geoStores) {
      if (!row.platformPool) continue;
      const km = haversineDistance(
        [coords.lng, coords.lat],
        [row.lng, row.lat],
      );
      if (km <= FLEET_PLATFORM_STORE_RADIUS_KM) {
        out.add(row.storeId);
      }
    }

    for (const row of geoStores) {
      if (row.platformPool) continue;
      const members =
        await this.storeDeliveryDrivers.listActiveDriverUserIdsForStore(
          row.storeId,
        );
      if (!members.includes(uid)) continue;
      const km = haversineDistance(
        [coords.lng, coords.lat],
        [row.lng, row.lat],
      );
      if (km <= FLEET_PLATFORM_STORE_RADIUS_KM) {
        out.add(row.storeId);
      }
    }

    return [...out];
  }

  private async resolveAgentCoordinates(
    agentUserId: string,
  ): Promise<{ lat: number; lng: number } | null> {
    const app = await this.applications
      .findOne({
        user: new Types.ObjectId(agentUserId),
        status: DeliveryAgentApplicationStatus.APPROVED,
      })
      .select('lastLatitude lastLongitude')
      .lean()
      .exec();
    if (
      app &&
      typeof app.lastLatitude === 'number' &&
      typeof app.lastLongitude === 'number' &&
      Number.isFinite(app.lastLatitude) &&
      Number.isFinite(app.lastLongitude) &&
      !(app.lastLatitude === 0 && app.lastLongitude === 0)
    ) {
      return { lat: app.lastLatitude, lng: app.lastLongitude };
    }
    return null;
  }

  private async loadGeoStores(): Promise<GeoStore[]> {
    const now = Date.now();
    if (
      this.geoStoreCache &&
      now - this.geoStoreCache.at < this.geoStoreCacheTtlMs
    ) {
      return this.geoStoreCache.rows;
    }

    const stores = await this.storeModel
      .find({})
      .select('vendorManagesDeliveryDrivers supportsShipping address')
      .populate({ path: 'address', select: 'location' })
      .lean()
      .exec();

    const rows: GeoStore[] = [];
    const storeIds: string[] = [];
    for (const store of stores) {
      const storeId = String(store._id ?? '').trim();
      if (!storeId) continue;
      storeIds.push(storeId);
    }
    const selfDeliveryByStore =
      await this.subscriptions.resolveSelfDeliveryRequiredByStoreIds(storeIds);

    for (const store of stores) {
      const storeId = String(store._id ?? '').trim();
      if (!storeId) continue;
      const addr = store.address as
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
      const lng = Number(c[0]);
      const lat = Number(c[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      rows.push({
        storeId,
        lng,
        lat,
        platformPool: selfDeliveryByStore.get(storeId) !== true,
      });
    }

    this.geoStoreCache = { at: now, rows };
    return rows;
  }
}
