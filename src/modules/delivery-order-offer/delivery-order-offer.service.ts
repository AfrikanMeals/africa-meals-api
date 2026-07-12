import {
  BadRequestException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { DeliveryAgentService } from '@modules/delivery-agent/delivery-agent.service';
import {
  agentHasDeliveryCapacity,
  maxConcurrentOrdersFromApplication,
} from '@modules/delivery-agent/delivery-agent-capacity.util';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { OrdersService } from '@modules/orders/orders.service';
import { StoreDeliveryDriversService } from '@modules/store-delivery-drivers/store-delivery-drivers.service';
import { StoreDeliveryAssignmentModeEnum } from '@schemas/store.schema';
import {
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationStatus,
} from '@schemas/delivery-agent-application.schema';
import {
  DeliveryOrderOfferModel,
  DeliveryOrderOfferStatus,
} from '@schemas/delivery-order-offer.schema';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { WsDeliveryOfferNotifyService } from '@modules/ws-notify/ws-delivery-offer-notify.service';
import {
  parseOfferTimeoutSec,
  rankDeliveryOfferCandidates,
  type DeliveryOfferCandidateInput,
} from './delivery-order-offer.ranking';

type CascadeState = {
  candidateUserIds: string[];
  nextRank: number;
};

@Injectable()
export class DeliveryOrderOfferService {
  private readonly logger = new Logger(DeliveryOrderOfferService.name);
  /** File classée en mémoire pendant une cascade (rechargé depuis DB si besoin). */
  private readonly cascadeByOrderId = new Map<string, CascadeState>();

  constructor(
    @InjectModel(DeliveryOrderOfferModel.name)
    private readonly _offers: Model<DeliveryOrderOfferModel>,
    @InjectModel(OrderModel.name)
    private readonly _orders: Model<OrderModel>,
    @InjectModel(DeliveryAgentApplicationModel.name)
    private readonly _applications: Model<DeliveryAgentApplicationModel>,
    @InjectModel(StoreModel.name)
    private readonly _stores: Model<StoreModel>,
    private readonly _storeDrivers: StoreDeliveryDriversService,
    private readonly _notifications: NotificationsService,
    private readonly _wsOffer: WsDeliveryOfferNotifyService,
    private readonly _config: ConfigService,
    @Inject(forwardRef(() => DeliveryAgentService))
    private readonly _deliveryAgent: DeliveryAgentService,
    @Inject(forwardRef(() => OrdersService))
    private readonly _ordersService: OrdersService,
  ) {}

  offerTimeoutSec(): number {
    return parseOfferTimeoutSec(
      this._config.get<string>('DELIVERY_ORDER_OFFER_TIMEOUT_SEC'),
    );
  }

  /**
   * Après mark-ready : démarre la cascade si boutique AUTO + flotte ACTIVE.
   */
  async startCascadeAfterMarkReady(order: OrderModel | Record<string, unknown>): Promise<void> {
    try {
      const orderId =
        (order as { _id?: Types.ObjectId })._id?.toString() ??
        String((order as { id?: string }).id ?? '');
      if (!orderId || !Types.ObjectId.isValid(orderId)) return;

      const shouldShip =
        (order as { shouldShip?: boolean }).shouldShip === true ||
        (order as { should_ship?: boolean }).should_ship === true;
      if (!shouldShip) return;

      const storeId = this.storeIdFromOrder(order);
      if (!storeId) return;

      const store = await this._stores
        .findById(new Types.ObjectId(storeId))
        .select(
          'vendorManagesDeliveryDrivers deliveryAssignmentMode address name',
        )
        .populate('address', 'location')
        .lean()
        .exec();
      if (!store) return;
      if (!this._storeDrivers.isStoreManagedDelivery(store)) return;
      const mode = this._storeDrivers.storeAssignmentMode(store);
      if (mode !== StoreDeliveryAssignmentModeEnum.AUTO) return;

      const driverIds = await this._storeDrivers.listActiveDriverUserIdsForStore(
        storeId,
      );
      if (driverIds.length === 0) return;

      const status = String((order as { status?: string }).status ?? '');
      if (status !== OrderStatusEnum.APPROVED) return;
      const assigned = (order as { assignedDeliveryUser?: unknown })
        .assignedDeliveryUser;
      if (assigned) return;

      await this.cancelPendingOffersForOrder(orderId, 'cascade_restart');

      const ranked = await this.rankCandidates(storeId, store);
      if (ranked.length === 0) {
        this.logger.log(
          `auto-offer order=${orderId}: aucun candidat disponible`,
        );
        await this.onCascadeExhausted(orderId, storeId);
        return;
      }

      this.cascadeByOrderId.set(orderId, {
        candidateUserIds: ranked.map((r) => r.agentUserId),
        nextRank: 0,
      });

      await this.offerToNext(orderId);
    } catch (e) {
      this.logger.warn(
        `startCascadeAfterMarkReady failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  async rankCandidates(
    storeId: string,
    storeLean?: Record<string, unknown> | null,
  ): Promise<
    Array<{ agentUserId: string; distanceMeters: number | null }>
  > {
    const driverIds =
      await this._storeDrivers.listActiveDriverUserIdsForStore(storeId);
    if (driverIds.length === 0) return [];

    const oids = driverIds.map((id) => new Types.ObjectId(id));
    const apps = await this._applications
      .find({
        user: { $in: oids },
        status: DeliveryAgentApplicationStatus.APPROVED,
      })
      .select(
        'user dashboardAvailability vehicle maxConcurrentOrders lastLatitude lastLongitude',
      )
      .lean()
      .exec();

    const appByUser = new Map(
      apps.map((a) => [String((a as { user?: unknown }).user), a]),
    );

    const inputs: DeliveryOfferCandidateInput[] = [];
    for (const uid of driverIds) {
      const app = appByUser.get(uid);
      if (!app) continue;
      const agentId = new Types.ObjectId(uid);
      const capacity = await agentHasDeliveryCapacity(
        this._orders,
        app,
        agentId,
      );
      inputs.push({
        agentUserId: uid,
        dashboardAvailability:
          (app as { dashboardAvailability?: string }).dashboardAvailability ??
          null,
        activeOrderCount: capacity.activeCount,
        maxConcurrentOrders:
          capacity.capacity || maxConcurrentOrdersFromApplication(app),
        lastLatitude: (app as { lastLatitude?: number }).lastLatitude ?? null,
        lastLongitude: (app as { lastLongitude?: number }).lastLongitude ?? null,
      });
    }

    const storeDoc =
      storeLean ??
      ((await this._stores
        .findById(new Types.ObjectId(storeId))
        .select('address')
        .populate('address', 'location')
        .lean()
        .exec()) as Record<string, unknown> | null);

    const storeLngLat = this.storeLngLatFromDoc(storeDoc);
    return rankDeliveryOfferCandidates(inputs, storeLngLat).map((r) => ({
      agentUserId: r.agentUserId,
      distanceMeters: r.distanceMeters,
    }));
  }

  /**
   * Refuse le claim si une offre pending cible un autre livreur.
   */
  async assertClaimAllowedDuringOffer(
    orderId: string,
    agentUserId: string,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(orderId)) return;
    const order = await this._orders
      .findById(new Types.ObjectId(orderId))
      .select('activeDeliveryOfferId')
      .lean()
      .exec();
    const offerId = order?.activeDeliveryOfferId
      ? String(order.activeDeliveryOfferId)
      : '';
    if (!offerId || !Types.ObjectId.isValid(offerId)) return;

    const offer = await this._offers
      .findById(new Types.ObjectId(offerId))
      .select('status agentUserId')
      .lean()
      .exec();
    if (!offer || offer.status !== DeliveryOrderOfferStatus.PENDING) return;
    if (String(offer.agentUserId) !== String(agentUserId)) {
      throw new BadRequestException('delivery_offer_exclusive');
    }
  }

  async getPendingOfferForAgent(user: UserModel) {
    const agentId = new Types.ObjectId(String(user._id ?? user.id));
    const offer = await this._offers
      .findOne({
        agentUserId: agentId,
        status: DeliveryOrderOfferStatus.PENDING,
        expiresAt: { $gt: new Date() },
      })
      .sort({ offeredAt: -1 })
      .lean()
      .exec();
    if (!offer) return { offer: null };

    const order = await this._orders
      .findById(offer.orderId)
      .populate({
        path: 'store',
        select: 'name address currency',
        populate: { path: 'address', select: 'address city zipCode' },
      })
      .lean()
      .exec();
    if (!order || order.status !== OrderStatusEnum.APPROVED) {
      return { offer: null };
    }

    return {
      offer: {
        id: String(offer._id),
        orderId: String(offer.orderId),
        storeId: String(offer.storeId),
        rank: offer.rank,
        status: offer.status,
        distanceMeters: offer.distanceMeters ?? null,
        offeredAt: offer.offeredAt?.toISOString?.() ?? null,
        expiresAt: offer.expiresAt?.toISOString?.() ?? null,
        orderRef: `#AE-${String(offer.orderId).slice(-6).toUpperCase()}`,
        storeName:
          order.store && typeof order.store === 'object'
            ? String((order.store as { name?: string }).name ?? '')
            : '',
        timeoutSec: this.offerTimeoutSec(),
      },
    };
  }

  async acceptOffer(
    user: UserModel,
    orderId: string,
    offerId: string,
  ): Promise<Record<string, unknown>> {
    const agentId = String(user._id ?? user.id);
    const offer = await this.loadPendingOfferForAgent(
      orderId,
      offerId,
      agentId,
    );

    const now = new Date();
    const claimed = await this._offers
      .updateOne(
        {
          _id: offer._id,
          status: DeliveryOrderOfferStatus.PENDING,
          agentUserId: new Types.ObjectId(agentId),
        },
        {
          $set: {
            status: DeliveryOrderOfferStatus.ACCEPTED,
            respondedAt: now,
          },
        },
      )
      .exec();
    if (claimed.matchedCount === 0) {
      throw new BadRequestException('delivery_offer_not_pending');
    }

    await this._orders
      .updateOne(
        { _id: new Types.ObjectId(orderId) },
        { $unset: { activeDeliveryOfferId: 1 } },
      )
      .exec();

    this.cascadeByOrderId.delete(orderId);

    let assignResult: Record<string, unknown>;
    try {
      assignResult = (await this._deliveryAgent.assignSelfToOrder(
        user,
        orderId,
      )) as Record<string, unknown>;
    } catch (e) {
      await this._offers
        .updateOne(
          { _id: offer._id },
          {
            $set: {
              status: DeliveryOrderOfferStatus.CANCELLED,
              respondedAt: now,
            },
          },
        )
        .exec();
      throw e;
    }

    await this.notifyStaffOfferOutcome(orderId, {
      deliveryOfferStatus: 'accepted',
      assignedDeliveryUserId: agentId,
    });

    return {
      ok: true,
      offerId,
      orderId,
      ...assignResult,
    };
  }

  async rejectOffer(
    user: UserModel,
    orderId: string,
    offerId: string,
  ): Promise<{ ok: true; nextOffered: boolean }> {
    const agentId = String(user._id ?? user.id);
    const offer = await this.loadPendingOfferForAgent(
      orderId,
      offerId,
      agentId,
    );

    const now = new Date();
    const updated = await this._offers
      .updateOne(
        {
          _id: offer._id,
          status: DeliveryOrderOfferStatus.PENDING,
        },
        {
          $set: {
            status: DeliveryOrderOfferStatus.REJECTED,
            respondedAt: now,
          },
        },
      )
      .exec();
    if (updated.matchedCount === 0) {
      throw new BadRequestException('delivery_offer_not_pending');
    }

    await this._orders
      .updateOne(
        { _id: new Types.ObjectId(orderId) },
        { $unset: { activeDeliveryOfferId: 1 } },
      )
      .exec();

    const nextOffered = await this.offerToNext(orderId);
    return { ok: true, nextOffered };
  }

  /** Cron : expire les offres `pending` dépassées. */
  async processExpiredOffers(): Promise<{ expired: number }> {
    const now = new Date();
    const expired = await this._offers
      .find({
        status: DeliveryOrderOfferStatus.PENDING,
        expiresAt: { $lte: now },
      })
      .select('_id orderId agentUserId')
      .limit(50)
      .lean()
      .exec();

    let count = 0;
    for (const row of expired) {
      const offerId = String(row._id);
      const orderId = String(row.orderId);
      const res = await this._offers
        .updateOne(
          {
            _id: row._id,
            status: DeliveryOrderOfferStatus.PENDING,
          },
          {
            $set: {
              status: DeliveryOrderOfferStatus.EXPIRED,
              respondedAt: now,
            },
          },
        )
        .exec();
      if (res.matchedCount === 0) continue;
      count += 1;

      await this._orders
        .updateOne(
          {
            _id: new Types.ObjectId(orderId),
            activeDeliveryOfferId: row._id,
          },
          { $unset: { activeDeliveryOfferId: 1 } },
        )
        .exec();

      void this._wsOffer.notifyOffer({
        userId: String(row.agentUserId),
        orderId,
        offerId,
        status: 'expired',
      });

      await this.offerToNext(orderId);
    }
    return { expired: count };
  }

  async offerToNext(orderId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(orderId)) return false;

    const order = await this._orders
      .findById(new Types.ObjectId(orderId))
      .populate({
        path: 'store',
        select: 'name address currency vendorManagesDeliveryDrivers deliveryAssignmentMode',
        populate: { path: 'address', select: 'address city zipCode location' },
      })
      .lean()
      .exec();
    if (!order) return false;
    if (order.status !== OrderStatusEnum.APPROVED) return false;
    if (order.assignedDeliveryUser) return false;
    if (!order.shouldShip) return false;

    const storeId =
      order.store && typeof order.store === 'object' && order.store !== null
        ? String((order.store as { _id?: unknown })._id ?? '')
        : '';
    if (!storeId) return false;

    let state = this.cascadeByOrderId.get(orderId);
    if (!state) {
      const ranked = await this.rankCandidates(
        storeId,
        order.store as Record<string, unknown>,
      );
      const alreadyOffered = await this._offers
        .find({ orderId: new Types.ObjectId(orderId) })
        .select('agentUserId')
        .lean()
        .exec();
      const offeredSet = new Set(
        alreadyOffered.map((o) => String(o.agentUserId)),
      );
      const remaining = ranked
        .map((r) => r.agentUserId)
        .filter((id) => !offeredSet.has(id));
      if (remaining.length === 0) {
        await this.onCascadeExhausted(orderId, storeId);
        return false;
      }
      state = { candidateUserIds: remaining, nextRank: 0 };
      this.cascadeByOrderId.set(orderId, state);
    }

    while (state.nextRank < state.candidateUserIds.length) {
      const rank = state.nextRank;
      const agentUserId = state.candidateUserIds[rank];
      state.nextRank = rank + 1;

      const stillOk = await this.isAgentStillEligible(agentUserId);
      if (!stillOk) {
        await this._offers.create({
          orderId: new Types.ObjectId(orderId),
          storeId: new Types.ObjectId(storeId),
          agentUserId: new Types.ObjectId(agentUserId),
          rank,
          status: DeliveryOrderOfferStatus.SKIPPED,
          offeredAt: new Date(),
          expiresAt: new Date(),
          respondedAt: new Date(),
        });
        continue;
      }

      const rankedAgain = await this.rankCandidates(
        storeId,
        order.store as Record<string, unknown>,
      );
      const dist =
        rankedAgain.find((r) => r.agentUserId === agentUserId)
          ?.distanceMeters ?? null;

      const timeoutSec = this.offerTimeoutSec();
      const offeredAt = new Date();
      const expiresAt = new Date(offeredAt.getTime() + timeoutSec * 1000);

      let created: DeliveryOrderOfferModel;
      try {
        created = await this._offers.create({
          orderId: new Types.ObjectId(orderId),
          storeId: new Types.ObjectId(storeId),
          agentUserId: new Types.ObjectId(agentUserId),
          rank,
          status: DeliveryOrderOfferStatus.PENDING,
          distanceMeters: dist ?? undefined,
          offeredAt,
          expiresAt,
        });
      } catch (e) {
        this.logger.warn(
          `offer create failed order=${orderId} agent=${agentUserId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        continue;
      }

      await this._orders
        .updateOne(
          { _id: new Types.ObjectId(orderId) },
          { $set: { activeDeliveryOfferId: created._id } },
        )
        .exec();

      const storeName =
        order.store && typeof order.store === 'object'
          ? String((order.store as { name?: string }).name ?? '')
          : '';
      const orderRef = `#AE-${orderId.slice(-6).toUpperCase()}`;
      const offerPayload = {
        userId: agentUserId,
        orderId,
        offerId: String(created._id),
        storeId,
        storeName,
        orderRef,
        rank,
        distanceMeters: dist,
        expiresAt: expiresAt.toISOString(),
        offeredAt: offeredAt.toISOString(),
        timeoutSec,
        status: 'pending' as const,
      };

      this._wsOffer.notifyOffer(offerPayload);
      this._wsOffer.notifyStaffOfferSignal({
        orderId,
        storeId,
        status: OrderStatusEnum.APPROVED,
        deliveryOfferStatus: 'offered',
        deliveryOfferId: String(created._id),
        deliveryOfferAgentUserId: agentUserId,
        deliveryOfferExpiresAt: expiresAt.toISOString(),
      });

      void this._notifications
        .notifyCourierDeliveryOffer({
          recipientUserId: agentUserId,
          orderId,
          offerId: String(created._id),
          orderRef,
          storeName,
          storeId,
          expiresAt: expiresAt.toISOString(),
          timeoutSec,
        })
        .catch((err) =>
          this.logger.warn(
            `FCM courier offer: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );

      this.logger.log(
        `auto-offer order=${orderId} → agent=${agentUserId} rank=${rank} expires=${expiresAt.toISOString()}`,
      );
      return true;
    }

    this.cascadeByOrderId.delete(orderId);
    await this.onCascadeExhausted(orderId, storeId);
    return false;
  }

  /**
   * Si le livreur claim via assign-self pendant son offre pending,
   * finalise l’offre sans relancer la cascade.
   */
  async markAcceptedAfterDirectClaim(
    orderId: string,
    agentUserId: string,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(orderId) || !Types.ObjectId.isValid(agentUserId)) {
      return;
    }
    const now = new Date();
    const res = await this._offers
      .updateOne(
        {
          orderId: new Types.ObjectId(orderId),
          agentUserId: new Types.ObjectId(agentUserId),
          status: DeliveryOrderOfferStatus.PENDING,
        },
        {
          $set: {
            status: DeliveryOrderOfferStatus.ACCEPTED,
            respondedAt: now,
          },
        },
      )
      .exec();
    if (res.matchedCount === 0) return;

    await this._orders
      .updateOne(
        { _id: new Types.ObjectId(orderId) },
        { $unset: { activeDeliveryOfferId: 1 } },
      )
      .exec();
    this.cascadeByOrderId.delete(orderId);

    await this._offers
      .updateMany(
        {
          orderId: new Types.ObjectId(orderId),
          status: DeliveryOrderOfferStatus.PENDING,
        },
        {
          $set: {
            status: DeliveryOrderOfferStatus.CANCELLED,
            respondedAt: now,
          },
        },
      )
      .exec();
  }

  private async isAgentStillEligible(agentUserId: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(agentUserId)) return false;
    const agentId = new Types.ObjectId(agentUserId);
    const app = await this._applications
      .findOne({
        user: agentId,
        status: DeliveryAgentApplicationStatus.APPROVED,
      })
      .select('dashboardAvailability vehicle maxConcurrentOrders')
      .lean()
      .exec();
    if (!app) return false;
    if (app.dashboardAvailability === 'hors_ligne') return false;
    const capacity = await agentHasDeliveryCapacity(this._orders, app, agentId);
    return capacity.allowed;
  }

  private async loadPendingOfferForAgent(
    orderId: string,
    offerId: string,
    agentUserId: string,
  ) {
    if (!Types.ObjectId.isValid(orderId) || !Types.ObjectId.isValid(offerId)) {
      throw new BadRequestException('invalid_offer_id');
    }
    const offer = await this._offers.findById(new Types.ObjectId(offerId)).exec();
    if (!offer) throw new NotFoundException('delivery_offer_not_found');
    if (String(offer.orderId) !== orderId) {
      throw new BadRequestException('delivery_offer_order_mismatch');
    }
    if (String(offer.agentUserId) !== agentUserId) {
      throw new ForbiddenException('delivery_offer_not_yours');
    }
    if (offer.status !== DeliveryOrderOfferStatus.PENDING) {
      throw new BadRequestException('delivery_offer_not_pending');
    }
    if (offer.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('delivery_offer_expired');
    }
    return offer;
  }

  private async cancelPendingOffersForOrder(
    orderId: string,
    _reason: string,
  ): Promise<void> {
    const now = new Date();
    await this._offers
      .updateMany(
        {
          orderId: new Types.ObjectId(orderId),
          status: DeliveryOrderOfferStatus.PENDING,
        },
        {
          $set: {
            status: DeliveryOrderOfferStatus.CANCELLED,
            respondedAt: now,
          },
        },
      )
      .exec();
    await this._orders
      .updateOne(
        { _id: new Types.ObjectId(orderId) },
        { $unset: { activeDeliveryOfferId: 1 } },
      )
      .exec();
    this.cascadeByOrderId.delete(orderId);
  }

  private async onCascadeExhausted(
    orderId: string,
    storeId: string,
  ): Promise<void> {
    this.cascadeByOrderId.delete(orderId);
    await this._orders
      .updateOne(
        { _id: new Types.ObjectId(orderId) },
        { $unset: { activeDeliveryOfferId: 1 } },
      )
      .exec();

    await this.notifyStaffOfferOutcome(orderId, {
      deliveryOfferStatus: 'exhausted',
    });

    this.logger.log(`auto-offer exhausted order=${orderId} store=${storeId}`);
  }

  private async notifyStaffOfferOutcome(
    orderId: string,
    extra: {
      deliveryOfferStatus: 'accepted' | 'exhausted';
      assignedDeliveryUserId?: string;
    },
  ): Promise<void> {
    const order = await this._orders
      .findById(new Types.ObjectId(orderId))
      .populate('store', 'name owner address')
      .exec();
    if (!order) return;

    const isAccepted = extra.deliveryOfferStatus === 'accepted';
    const note = isAccepted
      ? 'Un livreur de la flotte a accepté la course'
      : 'Aucun livreur de la flotte n’a accepté — course en attente';

    this._ordersService.notifyStoreVendorsForOrderStatusChange(order, {
      reason: isAccepted ? 'order_shipped' : 'order_ready',
      status: isAccepted ? OrderStatusEnum.SHIPPED : OrderStatusEnum.APPROVED,
      note,
      isPickup: false,
      pushBodyOverride: note,
    });

    this._ordersService.notifyOrderPartiesRealtime(
      order,
      isAccepted ? OrderStatusEnum.SHIPPED : OrderStatusEnum.APPROVED,
      {
        deliveryOfferStatus: extra.deliveryOfferStatus,
        assignedDeliveryUserId: extra.assignedDeliveryUserId ?? null,
      },
    );

    this._wsOffer.notifyStaffOfferSignal({
      orderId,
      storeId: this.storeIdFromOrder(order) ?? undefined,
      status: isAccepted ? OrderStatusEnum.SHIPPED : OrderStatusEnum.APPROVED,
      deliveryOfferStatus: extra.deliveryOfferStatus,
      assignedDeliveryUserId: extra.assignedDeliveryUserId,
    });
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
}
