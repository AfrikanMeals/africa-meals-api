import { StripeConnectTransferService } from '@modules/billing/stripe/stripe-connect-transfer.service';
import { BusinessReportsService } from '@modules/business-reports/business-reports.service';
import { CartService } from '@modules/cart/cart.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { ProductsService } from '@modules/products/products.service';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CartItemModel, CartItemTypeEnum } from '@schemas/cart_item.schema';
import {
  OrdeLineItem,
  OrderModel,
  OrderRefundRequestEntryStatusEnum,
  OrderStatusEnum,
} from '@schemas/order.schema';
import {
  DeliveryDriverModel,
  DeliveryDriverStatutEnum,
} from '@schemas/delivery-driver.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { haversineDistance } from 'src/utils/helpers';
import { mapInChunks } from '@utils/map-in-chunks';
import { OrderStatusChangeSourceEnum } from '@schemas/order-status-event.schema';
import {
  generatePickupCode,
  normalizePickupCodeInput,
} from 'src/utils/pickup-code';
import {
  ConfirmPickupDto,
  CreateRefundRequestDto,
  FilterOrdersDto,
  RejectOrderDto,
} from './dto/orders.dto';
import {
  assertOrderCancelReasonPayload,
  resolveOrderCancelReasonDisplay,
} from './order-cancel-reasons';
import { OrderStatusEventsService } from './order-status-events.service';
import {
  WsOrderNotifyService,
  type OrderWsTrackingPayload,
} from '@modules/ws-notify/ws-order-notify.service';
import { StoreAccessService } from '@modules/teams/store-access.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  @InjectModel(OrderModel.name)
  private readonly _orderModel: Model<OrderModel>;

  @InjectModel(StoreModel.name)
  private readonly _storeModel: Model<StoreModel>;

  @InjectModel(DeliveryDriverModel.name)
  private readonly _deliveryDriverModel: Model<DeliveryDriverModel>;

  @Inject(CartService)
  private readonly _cartService: CartService;

  @Inject(ProductsService)
  private readonly _productsService: ProductsService;

  @Inject(NotificationsService)
  private readonly _notificationsService: NotificationsService;

  @Inject(BusinessReportsService)
  private readonly _businessReportsService: BusinessReportsService;

  @Inject(OrderStatusEventsService)
  private readonly _orderStatusEvents: OrderStatusEventsService;

  @Inject(WsOrderNotifyService)
  private readonly _wsOrderNotify: WsOrderNotifyService;

  @Inject(StoreAccessService)
  private readonly _storeAccess: StoreAccessService;

  @Inject(forwardRef(() => StripeConnectTransferService))
  private readonly _stripeTransfers: StripeConnectTransferService;

  /** Client + adresses de livraison (refs `addresses` peuplées). */
  private static readonly orderUserWithAddressesPopulate = {
    path: 'user',
    select: 'fullName email profileImage addresses',
    populate: { path: 'addresses' },
  } as const;

  private storeOwnerUserIdFromLean(store: unknown): string | null {
    if (!store || typeof store !== 'object' || !('owner' in store)) {
      return null;
    }
    const o = (store as { owner?: unknown }).owner;
    if (o instanceof Types.ObjectId) {
      return o.toHexString();
    }
    if (o && typeof o === 'object' && o !== null && '_id' in o) {
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
   * Restreint `filter.store` aux boutiques dont le nom correspond à `q`.
   * @returns `empty` si aucune boutique ne correspond ou si l’intersection avec le filtre courant est vide.
   */
  private async applyStoreNameSearch(
    filter: Record<string, unknown>,
    qRaw: string | undefined,
  ): Promise<'ok' | 'empty'> {
    const q = qRaw?.trim();
    if (!q) {
      return 'ok';
    }
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(esc, 'i');
    const matching = await this._storeModel
      .find({ name: rx })
      .select('_id')
      .limit(500)
      .lean()
      .exec();
    const matchIds = matching.map((s) => String(s._id));
    if (!matchIds.length) {
      return 'empty';
    }

    const cur = filter['store'];
    if (cur == null) {
      filter['store'] = {
        $in: matchIds.map((id) => new Types.ObjectId(id)),
      };
      return 'ok';
    }
    if (typeof cur === 'object' && cur !== null && '_id' in cur) {
      const sid = (cur as { _id: unknown })._id;
      const idStr =
        sid instanceof Types.ObjectId ? sid.toHexString() : String(sid);
      if (!matchIds.includes(idStr)) {
        return 'empty';
      }
      return 'ok';
    }
    if (typeof cur === 'object' && cur !== null && '$in' in cur) {
      const arr = (cur as { $in: unknown[] }).$in;
      const narrowed = arr.filter((oid) => {
        const idStr =
          oid instanceof Types.ObjectId
            ? oid.toHexString()
            : String(oid);
        return matchIds.includes(idStr);
      });
      if (!narrowed.length) {
        return 'empty';
      }
      filter['store'] = { $in: narrowed };
      return 'ok';
    }

    filter['store'] = {
      $in: matchIds.map((id) => new Types.ObjectId(id)),
    };
    return 'ok';
  }

  async filter(
    args: FilterOrdersDto,
    user: UserModel,
  ): Promise<{ data: OrderModel[] }> {
    const filter: Record<string, unknown> = {};

    if (user.type === UserTypeEnum.ADMIN) {
      if (args.storeId) {
        filter['store'] = { _id: args.storeId };
      }
    } else if (user.type === UserTypeEnum.VENDOR) {
      const rawStores = user.stores || [];
      const storeIds = rawStores.map((s: unknown) => {
        if (typeof s === 'object' && s !== null && '_id' in s) {
          return String((s as { _id: { toString: () => string } })._id);
        }
        return String(s);
      });
      if (!storeIds.length) {
        return { data: [] };
      }
      if (args.storeId) {
        if (!storeIds.includes(args.storeId)) {
          return { data: [] };
        }
        filter['store'] = { _id: args.storeId };
      } else {
        filter['store'] = { $in: storeIds };
      }
    } else {
      filter['user'] = new Types.ObjectId(String(user.id));
      if (args.storeId) {
        filter['store'] = { _id: args.storeId };
      }
    }

    if (args.status) {
      filter['status'] = args.status;
    }

    const search = await this.applyStoreNameSearch(filter, args.q);
    if (search === 'empty') {
      return { data: [] };
    }

    /** Liste mobile / admin : plafond par défaut (évite charger tout l’historique + populate profond). */
    const lim =
      typeof args.limit === 'number' && args.limit > 0
        ? Math.min(200, Math.max(1, args.limit))
        : 80;

    const skip =
      typeof args.skip === 'number' && args.skip > 0
        ? Math.min(10_000, Math.max(0, Math.floor(args.skip)))
        : 0;

    const data = await this._orderModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(lim)
      .populate({
        path: 'store',
        select:
          'name profileImage status currency acceptsOrders supportsShipping bio',
      })
      .populate(OrdersService.orderUserWithAddressesPopulate)
      .lean()
      .exec();

    let enriched = await this.attachClientOrderFlags(
      data as unknown as Record<string, unknown>[],
      user,
    );
    if (
      user.type === UserTypeEnum.VENDOR ||
      user.type === UserTypeEnum.ADMIN
    ) {
      enriched = this.attachDashboardOrderRefundFlags(enriched);
    }
    if (user.type !== UserTypeEnum.USER) {
      enriched = this.stripPickupCodeForNonClients(enriched);
    }

    return { data: enriched as unknown as OrderModel[] };
  }

  /** Le code retrait n’est visible que dans l’app client (pas admin / vendeur). */
  private stripPickupCodeForNonClients(
    rows: Record<string, unknown>[],
  ): Record<string, unknown>[] {
    return rows.map((o) => {
      const out = { ...o };
      delete out.pickupCode;
      delete out.pickup_code;
      return out;
    });
  }

  /** Remboursement : indicateurs pour le dashboard vendeur / admin. */
  private attachDashboardOrderRefundFlags(
    rows: Record<string, unknown>[],
  ): Record<string, unknown>[] {
    return rows.map((o) => {
      const refund = this.clientRefundFlags(o);
      return {
        ...o,
        canRequestRefund: refund.canRequestRefund,
        refundRequestState: refund.refundRequestState,
      };
    });
  }

  /** Indicateurs mobile : signalement déjà envoyé, éligibilité remboursement. */
  private async attachClientOrderFlags(
    rows: Record<string, unknown>[],
    user: UserModel,
  ): Promise<Record<string, unknown>[]> {
    if (user.type !== UserTypeEnum.USER || !rows.length) {
      return rows;
    }
    const orderIds = rows
      .map((o) => (o['_id'] != null ? String(o['_id']) : ''))
      .filter((id) => id.length > 0);
    const reported = await this._businessReportsService.reportedOrderIdsForUser(
      String(user.id),
      orderIds,
    );
    const enriched = rows.map((o) => {
      const id = o['_id'] != null ? String(o['_id']) : '';
      const refund = this.clientRefundFlags(o);
      return {
        ...o,
        hasBusinessReport: reported.has(id),
        canRequestRefund: refund.canRequestRefund,
        refundRequestState: refund.refundRequestState,
      };
    });
    return this.attachStatusEventsToOrders(enriched);
  }

  /** Historique des statuts (prêt → terminé) pour le calcul du temps total côté mobile. */
  private async attachStatusEventsToOrders(
    rows: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    if (!rows.length) return rows;
    const orderIds = rows
      .map((o) => (o['_id'] != null ? String(o['_id']) : ''))
      .filter((id) => id.length > 0);
    const byOrder =
      await this._orderStatusEvents.listTimelineByOrderIds(orderIds);
    return rows.map((o) => {
      const id = o['_id'] != null ? String(o['_id']) : '';
      const events = byOrder.get(id);
      if (!events?.length) return o;
      return { ...o, statusEvents: events };
    });
  }

  /** Remboursement : uniquement commande payée, pas encore en attente de livraison / livrée. */
  isRefundRequestAllowedForStatus(status: OrderStatusEnum | string): boolean {
    return String(status) === OrderStatusEnum.PAIED;
  }

  /**
   * Éligibilité remboursement côté client (liste / détail mobile).
   * `eligible` → annulation + demande possible ; `pending` / `processed` → déjà demandé ou traité.
   */
  clientRefundFlags(order: Record<string, unknown>): {
    canRequestRefund: boolean;
    refundRequestState: 'eligible' | 'pending' | 'processed' | 'unavailable';
  } {
    const status = String(order['status'] ?? '');
    const log = (
      (order['refundRequestLog'] ?? order['refund_request_log']) as
        | Array<{ status?: string }>
        | undefined
    ) ?? [];

    for (const row of log) {
      const s = String(row?.status ?? '');
      if (
        s === OrderRefundRequestEntryStatusEnum.PENDING ||
        s === OrderRefundRequestEntryStatusEnum.PAUSED
      ) {
        return { canRequestRefund: false, refundRequestState: 'pending' };
      }
    }
    for (const row of log) {
      const s = String(row?.status ?? '');
      if (
        s === OrderRefundRequestEntryStatusEnum.APPROVED ||
        s === OrderRefundRequestEntryStatusEnum.COMPLETED
      ) {
        return { canRequestRefund: false, refundRequestState: 'processed' };
      }
    }
    if (this.isRefundRequestAllowedForStatus(status)) {
      return { canRequestRefund: true, refundRequestState: 'eligible' };
    }
    if (status === OrderStatusEnum.CANCELLED) {
      return { canRequestRefund: false, refundRequestState: 'unavailable' };
    }
    return { canRequestRefund: false, refundRequestState: 'unavailable' };
  }

  async findOneById(id: string, user: UserModel) {
    const filter: Record<string, unknown> = { _id: id };

    if (user.type === UserTypeEnum.ADMIN) {
      // accès à toute commande
    } else if (user.type === UserTypeEnum.VENDOR) {
      const rawStores = user.stores || [];
      const storeIds = rawStores.map((s: unknown) => {
        if (typeof s === 'object' && s !== null && '_id' in s) {
          return String((s as { _id: { toString: () => string } })._id);
        }
        return String(s);
      });
      if (!storeIds.length) {
        throw new NotFoundException('order_not_found');
      }
      filter['store'] = { $in: storeIds };
    } else {
      filter['user'] = new Types.ObjectId(String(user.id));
    }

    const order = await this._orderModel
      .findOne(filter)
      .populate({
        path: 'store',
        populate: [
          {
            path: 'address',
          },
        ],
      })
      .populate(OrdersService.orderUserWithAddressesPopulate)
      .exec();

    if (!order) {
      throw new NotFoundException('order_not_found');
    }

    await this.ensurePickupCodeForOrderDoc(order);

    const plain = order.toObject() as Record<string, unknown>;
    let row: Record<string, unknown> = plain;
    if (user.type === UserTypeEnum.USER) {
      const [withFlags] = await this.attachClientOrderFlags([plain], user);
      row = withFlags;
    } else if (
      user.type === UserTypeEnum.VENDOR ||
      user.type === UserTypeEnum.ADMIN
    ) {
      row = this.attachDashboardOrderRefundFlags([plain])[0];
    }
    const [enriched] = await this.attachStatusEventsToOrders([row]);
    const out = enriched;
    if (user.type === UserTypeEnum.USER) {
      return out as unknown as typeof order;
    }
    return this.stripPickupCodeForNonClients([out])[0] as unknown as typeof order;
  }

  async createFromCart(storeId: string, user: UserModel) {
    const cart = await this._cartService.findOneByStoreId(storeId, user);

    if (!cart?.items?.length) {
      throw new NotFoundException('cart_is_empty');
    }
    // const store = cart.store;

    // if (!store?.acceptsOrders) {
    //   throw new ForbiddenException('store_does_not_accept_orders');
    // }

    const items: OrdeLineItem[] = await mapInChunks(cart.items, 4, async (item) => {
      const e = item.entity as
        | { title?: string; name?: string; profileImage?: string }
        | undefined;
      const label = (e?.title || e?.name || 'Article').trim() || 'Article';
      return {
        label,
        itemType: item.type!,
        pictureUrl: e?.profileImage,
        quantity: item.quantity!,
        price: item.price!,
        categoryTitle: await this.categoryTitleForCartLine(item),
      };
    });

    const calculatedPrice = items.reduce(
      (acc, item) => acc + item.price * item.quantity,
      0,
    );

    const order = await this._orderModel.create({
      status: OrderStatusEnum.CREATED,
      store: new Types.ObjectId(String(storeId)),
      user: new Types.ObjectId(String(user.id)),
      items,
      totalPrice: calculatedPrice, // TODO should we add shipping price here?
      shippingPrice: 0,
    });

    await this._orderStatusEvents.record({
      orderId: order._id.toString(),
      storeId: String(storeId),
      customerUserId: String(user.id),
      toStatus: OrderStatusEnum.CREATED,
      source: OrderStatusChangeSourceEnum.CHECKOUT,
      actorUserId: String(user.id),
    });

    // Ne pas passer par findOneById (ACL vendeur) : un compte VENDOR qui commande
    // chez une autre boutique échouait avec order_not_found après création.
    const created = await this._orderModel
      .findById(order._id)
      .populate({ path: 'store', select: 'name owner' })
      .exec();
    if (!created) {
      throw new NotFoundException('order_not_found');
    }
    const storePop = created.store as { name?: string } | null | undefined;
    await this._notificationsService.pushCustomerOrderCreated({
      userId: String(user.id),
      orderId: created._id.toString(),
      storeName: storePop?.name?.trim() || undefined,
      storeId: String(storeId),
    });

    const sto = await this._storeModel
      .findById(new Types.ObjectId(String(storeId)))
      .select('owner name')
      .lean()
      .exec();
    const sname = (sto as { name?: string } | null)?.name?.trim();
    const vendorIds = (
      await this._storeAccess.listStorePushRecipientUserIds(String(storeId))
    ).filter((id) => id !== String(user.id));
    if (vendorIds.length > 0) {
      void this._notificationsService
        .pushVendorOrderNotify({
          vendorUserIds: vendorIds,
          title: 'Nouvelle commande',
          body: `${sname || 'Boutique'} : nouvelle commande (en attente de paiement).`,
          orderId: created._id.toString(),
          storeName: sname,
          reason: 'new_order',
          status: OrderStatusEnum.CREATED,
        })
        .catch((err) =>
          this.logger.warn(
            `FCM vendor new order: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }
    return created;
  }

  /** Commande bien passée en `paied` pour ce paiement Stripe groupé. */
  async isOrderPaidForStripePayment(
    orderId: string,
    stripeParentPaymentId: string,
  ): Promise<boolean> {
    const oid = orderId.trim();
    const pi = stripeParentPaymentId.trim();
    if (!Types.ObjectId.isValid(oid) || !pi) {
      return false;
    }
    const o = await this._orderModel
      .findById(new Types.ObjectId(oid))
      .select('status stripeParentPaymentId')
      .lean()
      .exec();
    if (!o) return false;
    return (
      String(o.status) === OrderStatusEnum.PAIED &&
      String(o.stripeParentPaymentId ?? '').trim() === pi
    );
  }

  /**
   * Reprise après échec Stripe (panier déjà vidé ou commande créée mais non finalisée).
   */
  async findRecoverableOrderIdForStorePayment(
    userId: string,
    storeId: string,
    stripeParentPaymentId: string,
  ): Promise<string | null> {
    if (
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(storeId) ||
      !stripeParentPaymentId.trim()
    ) {
      return null;
    }
    const uid = new Types.ObjectId(userId);
    const sid = new Types.ObjectId(storeId);
    const pi = stripeParentPaymentId.trim();

    const paid = await this._orderModel
      .findOne({
        user: uid,
        store: sid,
        stripeParentPaymentId: pi,
      })
      .select('_id')
      .lean()
      .exec();
    if (paid?._id) {
      return paid._id.toString();
    }

    const pending = await this._orderModel
      .findOne({
        user: uid,
        store: sid,
        status: OrderStatusEnum.CREATED,
      })
      .sort({ createdAt: -1 })
      .select('_id')
      .lean()
      .exec();
    if (pending?._id) {
      return pending._id.toString();
    }
    return null;
  }

  /**
   * Après paiement Stripe : statut payé + frais + total.
   * Si `opts.charged*Cents` sont fournis (métadonnées Stripe / payout), le total
   * suit le montant réellement encaissé (ex. panier avec code promo).
   */
  async markOrderPaidWithShipping(
    orderId: string,
    shippingPrice: number,
    opts?: {
      stripeParentPaymentId?: string;
      couponCode?: string;
      chargedGoodsCents?: number;
      chargedShipCents?: number;
    },
  ): Promise<void> {
    const ship = Math.max(0, Number(shippingPrice) || 0);
    const o = await this._orderModel
      .findById(new Types.ObjectId(orderId))
      .populate('store', 'name owner')
      .lean()
      .exec();
    if (!o) {
      throw new NotFoundException('order_not_found');
    }
    if (!o.items?.length) {
      throw new BadRequestException('order_has_no_items');
    }
    const prevStatus = String(o.status ?? '');
    const goods = (o.items as OrdeLineItem[]).reduce(
      (acc, item) => acc + item.price * item.quantity,
      0,
    );

    const gC =
      opts?.chargedGoodsCents != null && Number.isFinite(opts.chargedGoodsCents)
        ? Math.max(0, Math.round(opts.chargedGoodsCents))
        : null;
    const sC =
      opts?.chargedShipCents != null && Number.isFinite(opts.chargedShipCents)
        ? Math.max(0, Math.round(opts.chargedShipCents))
        : null;

    let totalPrice: number;
    let shippingStored: number;
    if (gC != null && sC != null) {
      totalPrice = Math.round((gC + sC + Number.EPSILON)) / 100;
      shippingStored = sC / 100;
    } else {
      shippingStored = ship;
      totalPrice =
        Math.round((goods + shippingStored) * 100 + Number.EPSILON) / 100;
    }

    const isPickup = shippingStored <= 0;
    const $set: Record<string, unknown> = {
      status: OrderStatusEnum.PAIED,
      shippingPrice: shippingStored,
      totalPrice,
      shouldShip: !isPickup,
    };
    if (isPickup) {
      $set['pickupCode'] = generatePickupCode();
    }
    if (opts?.stripeParentPaymentId?.trim()) {
      $set['stripeParentPaymentId'] = opts.stripeParentPaymentId.trim();
    }
    if (opts?.couponCode?.trim()) {
      $set['couponCode'] = opts.couponCode.trim().toUpperCase();
    }
    if (gC != null) {
      $set['stripeChargedGoodsCents'] = gC;
    }
    if (sC != null) {
      $set['stripeChargedShipCents'] = sC;
    }

    await this._orderModel
      .updateOne({ _id: new Types.ObjectId(orderId) }, { $set })
      .exec();

    if (prevStatus !== OrderStatusEnum.PAIED) {
      let storeIdForEvent: string | undefined;
      const rawStoreEv = o.store as unknown;
      if (rawStoreEv instanceof Types.ObjectId) {
        storeIdForEvent = rawStoreEv.toHexString();
      } else if (
        rawStoreEv &&
        typeof rawStoreEv === 'object' &&
        '_id' in rawStoreEv
      ) {
        const sid = (rawStoreEv as { _id: unknown })._id;
        storeIdForEvent =
          sid instanceof Types.ObjectId ? sid.toHexString() : String(sid);
      }
      let customerIdForEvent: string | undefined;
      const rawUserEv = o.user as unknown;
      if (rawUserEv instanceof Types.ObjectId) {
        customerIdForEvent = rawUserEv.toHexString();
      } else if (
        rawUserEv &&
        typeof rawUserEv === 'object' &&
        '_id' in rawUserEv
      ) {
        const uid = (rawUserEv as { _id: unknown })._id;
        customerIdForEvent =
          uid instanceof Types.ObjectId ? uid.toHexString() : String(uid);
      }
      await this._orderStatusEvents.record({
        orderId,
        storeId: storeIdForEvent,
        customerUserId: customerIdForEvent,
        fromStatus: prevStatus || undefined,
        toStatus: OrderStatusEnum.PAIED,
        source: OrderStatusChangeSourceEnum.STRIPE,
      });
    }

    if (prevStatus !== OrderStatusEnum.PAIED) {
      const rawUser = o.user as
        | Types.ObjectId
        | { _id?: Types.ObjectId }
        | null
        | undefined;
      let uid: string | null = null;
      if (rawUser instanceof Types.ObjectId) {
        uid = rawUser.toHexString();
      } else if (
        rawUser &&
        typeof rawUser === 'object' &&
        '_id' in rawUser &&
        rawUser._id instanceof Types.ObjectId
      ) {
        uid = rawUser._id.toHexString();
      } else if (rawUser != null) {
        uid = String(rawUser);
      }
      let storeName: string | undefined;
      let storeIdForNotif: string | undefined;
      const rawStore = o.store as unknown;
      if (rawStore && typeof rawStore === 'object' && rawStore !== null) {
        const stObj = rawStore as { _id?: unknown; name?: unknown };
        const nm = stObj.name;
        if (typeof nm === 'string' && nm.trim()) {
          storeName = nm.trim();
        }
        const sid = stObj._id;
        if (sid instanceof Types.ObjectId) {
          storeIdForNotif = sid.toHexString();
        } else if (typeof sid === 'string' && Types.ObjectId.isValid(sid)) {
          storeIdForNotif = sid;
        }
      }
      if (uid && Types.ObjectId.isValid(uid)) {
        void this._notificationsService
          .pushCustomerOrderStatusChanged({
            userId: uid,
            orderId,
            storeName,
            storeId: storeIdForNotif,
            previousStatus: prevStatus,
            newStatus: OrderStatusEnum.PAIED,
          })
          .catch((err) =>
            this.logger.warn(
              `FCM order paid: ${err instanceof Error ? err.message : String(err)}`,
            ),
          );
        const storeIdPaid = storeIdForNotif;
        if (storeIdPaid) {
          const vendorIds = (
            await this._storeAccess.listStorePushRecipientUserIds(storeIdPaid)
          ).filter((id) => id !== uid);
          if (vendorIds.length > 0) {
            void this._notificationsService
              .pushVendorOrderNotify({
                vendorUserIds: vendorIds,
                title: 'Commande payée',
                body: `${storeName ?? 'Boutique'} : la commande a été payée.`,
                orderId,
                storeName,
                reason: 'order_paid',
                status: OrderStatusEnum.PAIED,
              })
              .catch((err) =>
                this.logger.warn(
                  `FCM vendor order paid: ${err instanceof Error ? err.message : String(err)}`,
                ),
              );
          }
        }
      }
      void this.notifyPartiesOrderRealtimeByOrderId(
        orderId,
        OrderStatusEnum.PAIED,
      );
    }
  }

  async calculateShippingPrice(orderId: string, user: UserModel) {
    const order = await this.findOneById(orderId, user);
    // console.log(
    //   '🚀 ~ OrdersService ~ calculateShippingPrice ~ order:',
    //   JSON.stringify(order),
    // );

    const shippingZones = order.store.shippingZones;
    const store = order.store;

    if (!store.supportsShipping) {
      return {
        price: 0,
        distance: 0,
      };
    }

    if (!shippingZones?.length) {
      throw new NotFoundException('store_shipping_zones_not_found');
    }

    const storeAddress = order.store.address;
    if (!storeAddress) {
      throw new NotFoundException('store_address_not_found');
    }

    const usersAddress =
      (user.addresses || []).find((a) => a.isDefault) || user.addresses[0];
    if (!usersAddress) {
      throw new NotFoundException('user_address_not_found');
    }

    // Calculate distance between store and users address
    const distance = +haversineDistance(
      usersAddress.location.coordinates as [number, number],
      store.address.location.coordinates as [number, number],
    )?.toFixed(2);

    console.log(
      '🚀 ~ OrdersService ~ calculateShippingPrice ~ distance:',
      usersAddress.address + (usersAddress.id ? ` (${usersAddress.id})` : ''),
      '=>',
      store.address.address + ` (${store.address.id})`,
    );
    const shippingZone = shippingZones.find(
      (zone) => zone.minDistance <= distance && zone.maxDistance >= distance,
    );

    if (!shippingZone) {
      const maxShippingZone = shippingZones.sort(
        (a, b) => b.maxDistance - a.maxDistance,
      )[0];

      if (maxShippingZone.minDistance <= distance) {
        throw new NotFoundException('out_of_shipping_zone');
      }

      throw new NotFoundException('shipping_zone_not_found');
    }

    return {
      price: shippingZone.price,
      label: shippingZone.label,
      distance,
    };
  }

  /** Catégorie du menu au moment de l’achat (libellé produit / offre). */
  private async categoryTitleForCartLine(
    item: Partial<CartItemModel> & {
      entity?: { title?: string; profileImage?: string; category?: unknown };
    },
  ): Promise<string | undefined> {
    const type = item.type;
    if (!type) {
      return undefined;
    }
    if (type === CartItemTypeEnum.PRODUCT) {
      const cat = item.entity?.category;
      if (
        cat &&
        typeof cat === 'object' &&
        cat !== null &&
        'title' in cat &&
        typeof (cat as { title?: unknown }).title === 'string'
      ) {
        return (cat as { title: string }).title;
      }
      return undefined;
    }
    if (type === CartItemTypeEnum.PRODUCT_EXTRA && item.productId) {
      const p = await this._productsService.findOneById(String(item.productId));
      const cat = p?.category as { title?: string } | undefined;
      return cat?.title;
    }
    if (type === CartItemTypeEnum.OFFER) {
      return 'Offre';
    }
    if (type === CartItemTypeEnum.DRINK) {
      return 'Boisson';
    }
    return undefined;
  }

  /** Commande retrait sur place (pas de livraison). */
  isPickupOrder(order: {
    shouldShip?: boolean;
    shippingPrice?: number;
  }): boolean {
    if (order.shouldShip === true) return false;
    const ship = Number(order.shippingPrice ?? 0);
    return !(Number.isFinite(ship) && ship > 0);
  }

  private async ensurePickupCodeForOrderDoc(
    order: OrderModel | Record<string, unknown>,
  ): Promise<void> {
    const oid =
      (order as { _id?: Types.ObjectId })._id?.toString() ??
      (order as { id?: string }).id;
    if (!oid || !Types.ObjectId.isValid(oid)) return;

    const st = String((order as { status?: string }).status ?? '');
    if (
      st === OrderStatusEnum.CREATED ||
      st === OrderStatusEnum.CANCELLED ||
      st === OrderStatusEnum.COMPLETED
    ) {
      return;
    }
    const isPickup = this.isPickupOrder(
      order as { shouldShip?: boolean; shippingPrice?: number },
    );
    const isDeliveryReady =
      !isPickup &&
      (st === OrderStatusEnum.APPROVED || st === OrderStatusEnum.SHIPPED);
    if (!isPickup && !isDeliveryReady) {
      return;
    }
    const existing = String(
      (order as { pickupCode?: string }).pickupCode ?? '',
    ).trim();
    if (existing.length >= 4) return;

    const code = generatePickupCode();
    await this._orderModel
      .updateOne({ _id: new Types.ObjectId(oid) }, { $set: { pickupCode: code } })
      .exec();
    (order as { pickupCode?: string }).pickupCode = code;
  }

  /**
   * Vendeur / admin : commande payée → `approved` (prête livraison ou retrait).
   */
  async markOrderReady(
    orderId: string,
    user: UserModel,
  ): Promise<{
    orderId: string;
    status: OrderStatusEnum;
    isPickup: boolean;
  }> {
    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) {
      throw new NotFoundException('order_not_found');
    }

    const order = await this._orderModel
      .findById(new Types.ObjectId(oid))
      .populate('store', 'name owner address')
      .populate(OrdersService.orderUserWithAddressesPopulate)
      .exec();
    if (!order) {
      throw new NotFoundException('order_not_found');
    }

    await this.assertUserCanManageOrderStore(user, order);

    const st = order.status as OrderStatusEnum;
    if (st === OrderStatusEnum.APPROVED) {
      throw new BadRequestException('order_already_ready');
    }
    if (st !== OrderStatusEnum.PAIED) {
      throw new BadRequestException('order_ready_invalid_status');
    }

    const isPickup = this.isPickupOrder(order);
    const prevStatus = st;
    order.status = OrderStatusEnum.APPROVED;
    await order.save();

    const storeId = this.storeIdFromOrderDoc(order);
    const customerId = this.userIdFromOrderDoc(order);
    await this._orderStatusEvents.record({
      orderId: oid,
      storeId,
      customerUserId: customerId,
      fromStatus: prevStatus,
      toStatus: OrderStatusEnum.APPROVED,
      source: OrderStatusChangeSourceEnum.VENDOR,
      actorUserId: String(user.id),
      note: isPickup ? 'Prête pour retrait' : 'Prête pour livraison',
    });

    if (customerId) {
      const storeName = this.storeNameFromPopulated(order.store);
      const readyLabel = isPickup
        ? 'Prête à être retirée'
        : 'Prête pour la livraison';
      void this._notificationsService
        .pushCustomerOrderStatusChanged({
          userId: customerId,
          orderId: oid,
          storeName,
          storeId: storeId ?? undefined,
          previousStatus: prevStatus,
          newStatus: OrderStatusEnum.APPROVED,
          bodyOverride: readyLabel,
        })
        .catch((err) =>
          this.logger.warn(
            `FCM order ready: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }

    await this.ensurePickupCodeForOrderDoc(order);
    this.notifyPartiesOrderRealtimeFromDoc(order, OrderStatusEnum.APPROVED);

    return { orderId: oid, status: OrderStatusEnum.APPROVED, isPickup };
  }

  /**
   * Vendeur / admin : refuse ou annule la commande avec motif structuré.
   */
  async rejectOrder(
    orderId: string,
    user: UserModel,
    dto: RejectOrderDto,
  ): Promise<{
    orderId: string;
    status: OrderStatusEnum;
    cancelReasonCode: string;
    cancelReasonDetails: string;
  }> {
    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) {
      throw new NotFoundException('order_not_found');
    }

    const source =
      user.type === UserTypeEnum.ADMIN ? ('admin' as const) : ('vendor' as const);

    try {
      assertOrderCancelReasonPayload({
        source,
        reasonCode: dto.reasonCode,
        customDetails: dto.details,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'cancel_reason_invalid';
      throw new BadRequestException(msg);
    }

    const resolved = resolveOrderCancelReasonDisplay({
      source,
      reasonCode: dto.reasonCode,
      customDetails: dto.details,
    });

    const order = await this._orderModel
      .findById(new Types.ObjectId(oid))
      .populate('store', 'name owner address')
      .populate(OrdersService.orderUserWithAddressesPopulate)
      .exec();
    if (!order) {
      throw new NotFoundException('order_not_found');
    }

    await this.assertUserCanManageOrderStore(user, order);

    const st = order.status as OrderStatusEnum;
    if (st === OrderStatusEnum.CANCELLED) {
      throw new BadRequestException('order_already_cancelled');
    }
    if (
      st === OrderStatusEnum.CREATED ||
      st === OrderStatusEnum.SHIPPED ||
      st === OrderStatusEnum.COMPLETED
    ) {
      throw new BadRequestException('order_reject_invalid_status');
    }

    const prevStatus = st;
    order.status = OrderStatusEnum.CANCELLED;
    order.cancelReasonCode = resolved.code;
    order.cancelReasonDetails = resolved.details;
    order.cancelReasonSource = source;
    await order.save();

    const storeId = this.storeIdFromOrderDoc(order);
    const customerId = this.userIdFromOrderDoc(order);
    await this._orderStatusEvents.record({
      orderId: oid,
      storeId,
      customerUserId: customerId,
      fromStatus: prevStatus,
      toStatus: OrderStatusEnum.CANCELLED,
      source:
        source === 'admin'
          ? OrderStatusChangeSourceEnum.DASHBOARD
          : OrderStatusChangeSourceEnum.VENDOR,
      actorUserId: String(user.id),
      note: `Refus : ${resolved.details}`.slice(0, 500),
    });

    if (customerId) {
      void this._notificationsService
        .pushCustomerOrderStatusChanged({
          userId: customerId,
          orderId: oid,
          storeName: this.storeNameFromPopulated(order.store),
          storeId: storeId ?? undefined,
          previousStatus: prevStatus,
          newStatus: OrderStatusEnum.CANCELLED,
          bodyOverride: 'Commande refusée ou annulée par le restaurant',
        })
        .catch((err) =>
          this.logger.warn(
            `FCM order reject: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }

    void this.notifyPartiesOrderRealtimeByOrderId(
      oid,
      OrderStatusEnum.CANCELLED,
    );

    return {
      orderId: oid,
      status: OrderStatusEnum.CANCELLED,
      cancelReasonCode: resolved.code,
      cancelReasonDetails: resolved.details,
    };
  }

  /** Snapshot distance / progression pour le suivi temps réel (WS + mobile). */
  buildOrderTrackingPayload(
    order: OrderModel | Record<string, unknown>,
    status: OrderStatusEnum,
  ): OrderWsTrackingPayload {
    const oid =
      (order as { _id?: Types.ObjectId })._id?.toString() ??
      (order as { id?: string }).id ??
      '';
    const isPickup = this.isPickupOrder(
      order as { shouldShip?: boolean; shippingPrice?: number },
    );
    const { distanceKm, destinationLine, originLine } =
      this.resolveOrderTrackingGeo(order, isPickup);
    const progress = this.trackingProgressForStatus(status, isPickup);
    return {
      orderId: oid,
      status,
      isPickup,
      distanceKm,
      progress,
      destinationLine,
      originLine,
    };
  }

  private trackingProgressForStatus(
    status: OrderStatusEnum,
    isPickup: boolean,
  ): number {
    switch (status) {
      case OrderStatusEnum.PAIED:
        return 0.15;
      case OrderStatusEnum.APPROVED:
        return isPickup ? 0.35 : 0.25;
      case OrderStatusEnum.SHIPPED:
        return 0.72;
      case OrderStatusEnum.COMPLETED:
        return 1;
      case OrderStatusEnum.CANCELLED:
        return 0;
      default:
        return 0.1;
    }
  }

  private resolveOrderTrackingGeo(
    order: OrderModel | Record<string, unknown>,
    isPickup: boolean,
  ): {
    distanceKm?: number;
    destinationLine?: string;
    originLine?: string;
  } {
    const store = (order as { store?: unknown }).store;
    const user = (order as { user?: unknown }).user;

    const storeCoords = this.coordsFromAddressLike(
      store && typeof store === 'object' && 'address' in store
        ? (store as { address?: unknown }).address
        : undefined,
    );
    const userAddr = this.defaultUserAddressFromPopulated(user);
    const userCoords = userAddr?.coords;

    let distanceKm: number | undefined;
    if (storeCoords && userCoords) {
      distanceKm = +haversineDistance(
        userCoords,
        storeCoords,
      )?.toFixed(2);
    }

    const storeLine = this.formatAddressLine(
      store && typeof store === 'object' && 'address' in store
        ? (store as { address?: Record<string, unknown> }).address
        : undefined,
      store && typeof store === 'object' && 'name' in store
        ? String((store as { name?: unknown }).name ?? '')
        : '',
    );
    const userLine =
      userAddr?.line ??
      this.formatAddressLine(
        userAddr?.raw as Record<string, unknown> | undefined,
        '',
      );

    if (isPickup) {
      return {
        distanceKm,
        originLine: userLine || undefined,
        destinationLine: storeLine || undefined,
      };
    }
    return {
      distanceKm,
      originLine: storeLine || undefined,
      destinationLine: userLine || undefined,
    };
  }

  private defaultUserAddressFromPopulated(user: unknown): {
    line?: string;
    coords?: [number, number];
    raw?: Record<string, unknown>;
  } | null {
    if (!user || typeof user !== 'object') return null;
    const list = (user as { addresses?: unknown }).addresses;
    if (!Array.isArray(list) || list.length === 0) return null;
    let picked: Record<string, unknown> | null = null;
    for (const raw of list) {
      if (raw && typeof raw === 'object') {
        const m = raw as Record<string, unknown>;
        if (m.isDefault === true || m.is_default === true) {
          picked = m;
          break;
        }
      }
    }
    picked ??=
      list[0] && typeof list[0] === 'object'
        ? (list[0] as Record<string, unknown>)
        : null;
    if (!picked) return null;
    const coords = this.coordsFromAddressLike(picked);
    const street = String(picked.address ?? '').trim();
    const city = String(picked.city ?? '').trim();
    const zip = String(picked.zipCode ?? picked.zip_code ?? '').trim();
    const parts = [
      street,
      [city, zip].filter((s) => s.length > 0).join(' '),
    ].filter((s) => s.length > 0);
    return {
      line: parts.join(', ') || undefined,
      coords: coords ?? undefined,
      raw: picked,
    };
  }

  private coordsFromAddressLike(
    addr: unknown,
  ): [number, number] | undefined {
    if (!addr || typeof addr !== 'object') return undefined;
    const loc = (addr as { location?: { coordinates?: unknown } }).location;
    const c = loc?.coordinates;
    if (Array.isArray(c) && c.length >= 2) {
      const lng = Number(c[0]);
      const lat = Number(c[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return [lng, lat];
      }
    }
    return undefined;
  }

  private formatAddressLine(
    addr: Record<string, unknown> | undefined,
    fallback: string,
  ): string {
    if (!addr) return fallback.trim() || '';
    const street = String(addr.address ?? '').trim();
    const city = String(addr.city ?? '').trim();
    const zip = String(addr.zipCode ?? addr.zip_code ?? '').trim();
    const parts = [
      street,
      [city, zip].filter((s) => s.length > 0).join(' '),
    ].filter((s) => s.length > 0);
    const line = parts.join(', ');
    return line || fallback.trim();
  }

  private notifyCustomerOrderRealtime(
    customerId: string | undefined,
    tracking: OrderWsTrackingPayload,
  ): void {
    if (!customerId) return;
    this._wsOrderNotify.notifyCustomerOrderUpdate(customerId, tracking);
    this._wsOrderNotify.notifyCustomerOrderTracking(customerId, tracking);
  }

  /**
   * WS temps réel : client, vendeur propriétaire de la boutique, admins plateforme.
   */
  notifyPartiesOrderRealtimeFromDoc(
    order: OrderModel | Record<string, unknown>,
    status: OrderStatusEnum,
    extra?: Partial<OrderWsTrackingPayload>,
  ): void {
    const tracking = {
      ...this.buildOrderTrackingPayload(order, status),
      ...extra,
    };
    const customerId = this.userIdFromOrderDoc(order as OrderModel);
    if (customerId) {
      this.notifyCustomerOrderRealtime(customerId, tracking);
    }
    const vendorId = this.storeOwnerUserIdFromLean(
      (order as { store?: unknown }).store,
    );
    if (vendorId && vendorId !== customerId) {
      this._wsOrderNotify.notifyCustomerOrderUpdate(vendorId, tracking);
      this._wsOrderNotify.notifyCustomerOrderTracking(vendorId, tracking);
    }
    this._wsOrderNotify.notifyStaffOrderBroadcast(tracking);
  }

  async notifyPartiesOrderRealtimeByOrderId(
    orderId: string,
    status: OrderStatusEnum,
    extra?: Partial<OrderWsTrackingPayload>,
  ): Promise<void> {
    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) return;
    const order = await this._orderModel
      .findById(new Types.ObjectId(oid))
      .populate({
        path: 'store',
        populate: [{ path: 'address' }],
      })
      .populate(OrdersService.orderUserWithAddressesPopulate)
      .exec();
    if (!order) return;
    this.notifyPartiesOrderRealtimeFromDoc(order, status, extra);
  }

  /**
   * Client : génère un nouveau code retrait (retrait actif, commande payée).
   */
  async regeneratePickupCodeForClient(
    orderId: string,
    user: UserModel,
  ): Promise<{ orderId: string; pickupCode: string }> {
    if (user.type !== UserTypeEnum.USER) {
      throw new ForbiddenException('client_only');
    }

    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) {
      throw new NotFoundException('order_not_found');
    }

    const uid = new Types.ObjectId(String(user.id));
    const order = await this._orderModel
      .findOne({ _id: new Types.ObjectId(oid), user: uid })
      .select('status shouldShip shippingPrice pickupCode')
      .exec();
    if (!order) {
      throw new NotFoundException('order_not_found');
    }

    const isPickup = this.isPickupOrder(order);
    const st = order.status as OrderStatusEnum;
    if (st === OrderStatusEnum.CREATED) {
      throw new BadRequestException('pickup_order_not_paid');
    }
    if (st === OrderStatusEnum.CANCELLED) {
      throw new BadRequestException('pickup_order_cancelled');
    }
    if (st === OrderStatusEnum.COMPLETED) {
      throw new BadRequestException('pickup_already_completed');
    }
    if (isPickup) {
      // retrait : payée → terminée
    } else if (
      st !== OrderStatusEnum.APPROVED &&
      st !== OrderStatusEnum.SHIPPED
    ) {
      throw new BadRequestException('delivery_code_not_available_yet');
    }

    const code = generatePickupCode();
    await this._orderModel
      .updateOne({ _id: new Types.ObjectId(oid) }, { $set: { pickupCode: code } })
      .exec();

    void this.notifyPartiesOrderRealtimeByOrderId(
      oid,
      order.status as OrderStatusEnum,
      { pickupCode: code },
    );

    return { orderId: oid, pickupCode: code };
  }

  /**
   * Vendeur / admin : valide le code retrait → statut `completed` + horodatage.
   */
  async confirmPickupByCode(
    orderId: string,
    user: UserModel,
    dto: ConfirmPickupDto,
  ): Promise<{
    orderId: string;
    status: OrderStatusEnum;
    pickedUpAt: Date;
  }> {
    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) {
      throw new NotFoundException('order_not_found');
    }

    const order = await this._orderModel
      .findById(new Types.ObjectId(oid))
      .populate('store', 'name owner')
      .exec();
    if (!order) {
      throw new NotFoundException('order_not_found');
    }

    await this.assertUserCanManageOrderStore(user, order);

    const isPickup = this.isPickupOrder(order);
    const st = order.status as OrderStatusEnum;
    if (st === OrderStatusEnum.COMPLETED) {
      throw new BadRequestException('pickup_already_completed');
    }
    if (st === OrderStatusEnum.CREATED) {
      throw new BadRequestException('pickup_order_not_paid');
    }
    if (st === OrderStatusEnum.CANCELLED) {
      throw new BadRequestException('pickup_order_cancelled');
    }
    if (isPickup) {
      if (st === OrderStatusEnum.SHIPPED) {
        throw new BadRequestException('pickup_not_applicable_shipped_status');
      }
    } else if (
      st !== OrderStatusEnum.APPROVED &&
      st !== OrderStatusEnum.SHIPPED
    ) {
      throw new BadRequestException('delivery_confirm_invalid_status');
    }

    await this.ensurePickupCodeForOrderDoc(order);
    const expected = normalizePickupCodeInput(
      String(order.pickupCode ?? ''),
    );
    const provided = normalizePickupCodeInput(dto.code);
    if (!expected || expected !== provided) {
      throw new BadRequestException('pickup_code_invalid');
    }

    const prevStatus = st;
    const pickedUpAt = new Date();
    order.status = OrderStatusEnum.COMPLETED;
    order.pickedUpAt = pickedUpAt;
    await order.save();

    const storeId = this.storeIdFromOrderDoc(order);
    const customerId = this.userIdFromOrderDoc(order);
    await this._orderStatusEvents.record({
      orderId: oid,
      storeId,
      customerUserId: customerId,
      fromStatus: prevStatus,
      toStatus: OrderStatusEnum.COMPLETED,
      source: OrderStatusChangeSourceEnum.VENDOR,
      actorUserId: String(user.id),
      note: isPickup
        ? 'Retrait confirmé (code validé)'
        : 'Livraison confirmée (code validé)',
    });

    if (customerId) {
      void this._notificationsService
        .pushCustomerOrderStatusChanged({
          userId: customerId,
          orderId: oid,
          storeName: this.storeNameFromPopulated(order.store),
          storeId: storeId ?? undefined,
          previousStatus: prevStatus,
          newStatus: OrderStatusEnum.COMPLETED,
        })
        .catch((err) =>
          this.logger.warn(
            `FCM order completed: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }

    const populated = await this._orderModel
      .findById(new Types.ObjectId(oid))
      .populate({
        path: 'store',
        populate: [{ path: 'address' }],
      })
      .populate(OrdersService.orderUserWithAddressesPopulate)
      .exec();
    this.notifyPartiesOrderRealtimeFromDoc(
      populated ?? order,
      OrderStatusEnum.COMPLETED,
    );

    if (!isPickup && order.shouldShip === true) {
      void this._stripeTransfers
        .transferDeliveryShareForCompletedOrder({ orderId: oid })
        .then((tr) => {
          if (!tr.transferred && tr.skippedReason) {
            this.logger.warn(
              `Delivery Connect transfer skipped order=${oid}: ${tr.skippedReason}`,
            );
          }
        })
        .catch((err) => {
          this.logger.warn(
            `Delivery Connect transfer error order=${oid}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
    }

    return {
      orderId: oid,
      status: OrderStatusEnum.COMPLETED,
      pickedUpAt,
    };
  }

  private storeIdFromOrderDoc(order: OrderModel): string | undefined {
    const raw = order.store as unknown;
    if (raw instanceof Types.ObjectId) return raw.toHexString();
    if (raw && typeof raw === 'object' && '_id' in raw) {
      const id = (raw as { _id: unknown })._id;
      return id instanceof Types.ObjectId ? id.toHexString() : String(id);
    }
    return undefined;
  }

  private userIdFromOrderDoc(order: OrderModel): string | undefined {
    const raw = order.user as unknown;
    if (raw instanceof Types.ObjectId) return raw.toHexString();
    if (raw && typeof raw === 'object' && '_id' in raw) {
      const id = (raw as { _id: unknown })._id;
      return id instanceof Types.ObjectId ? id.toHexString() : String(id);
    }
    if (typeof raw === 'string' && Types.ObjectId.isValid(raw)) return raw;
    return undefined;
  }

  private storeNameFromPopulated(store: unknown): string | undefined {
    if (store && typeof store === 'object' && 'name' in store) {
      const nm = (store as { name?: unknown }).name;
      if (typeof nm === 'string' && nm.trim()) return nm.trim();
    }
    return undefined;
  }

  private async assertUserCanManageOrderStore(
    user: UserModel,
    order: OrderModel,
  ): Promise<void> {
    if (user.type === UserTypeEnum.ADMIN) {
      return;
    }
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_or_admin_only');
    }
    const storeId = this.storeIdFromOrderDoc(order);
    if (!storeId) {
      throw new BadRequestException('order_store_missing');
    }
    const rawStores = user.stores || [];
    const allowed = rawStores.some((s: unknown) => {
      if (typeof s === 'object' && s !== null && '_id' in s) {
        return String((s as { _id: unknown })._id) === storeId;
      }
      return String(s) === storeId;
    });
    if (!allowed) {
      throw new ForbiddenException('store_forbidden');
    }
  }

  /**
   * Client : enregistre une demande de remboursement (historique sur la commande).
   * Refus si statut commande / livraison incompatible ou si une demande est déjà en cours / traitée.
   */
  async submitRefundRequest(
    orderId: string,
    user: UserModel,
    dto: CreateRefundRequestDto,
  ): Promise<{ orderId: string; status: OrderRefundRequestEntryStatusEnum }> {
    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) {
      throw new NotFoundException('order_not_found');
    }
    const uid = new Types.ObjectId(String(user.id));
    const order = await this._orderModel
      .findOne({ _id: new Types.ObjectId(oid), user: uid })
      .select('status shouldShip refundRequestLog store')
      .populate('store', 'name')
      .exec();
    if (!order) {
      throw new NotFoundException('order_not_found');
    }
    const st = order.status as OrderStatusEnum;
    this.assertRefundRequestApplicableToOrder(st);
    const log = order.refundRequestLog ?? [];
    this.assertRefundRequestNotBlockedByHistory(log);

    try {
      assertOrderCancelReasonPayload({
        source: 'client',
        reasonCode: dto.reasonCode,
        customDetails: dto.details,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'cancel_reason_invalid';
      throw new BadRequestException(msg);
    }

    const resolved = resolveOrderCancelReasonDisplay({
      source: 'client',
      reasonCode: dto.reasonCode,
      customDetails: dto.details,
    });

    const prevStatus = st;
    order.status = OrderStatusEnum.CANCELLED;
    order.cancelReasonCode = resolved.code;
    order.cancelReasonDetails = resolved.details;
    order.cancelReasonSource = 'client';
    order.refundRequestLog = [
      ...(order.refundRequestLog ?? []),
      {
        status: OrderRefundRequestEntryStatusEnum.PENDING,
        details: resolved.details,
        requestedAt: new Date(),
      },
    ];
    await order.save();

    const storeId = this.storeIdFromOrderDoc(order);
    await this._orderStatusEvents.record({
      orderId: oid,
      storeId,
      customerUserId: String(user.id),
      fromStatus: prevStatus,
      toStatus: OrderStatusEnum.CANCELLED,
      source: OrderStatusChangeSourceEnum.SYSTEM,
      actorUserId: String(user.id),
      note: `Annulation client : ${resolved.details}`.slice(0, 500),
    });

    void this._notificationsService
      .pushCustomerOrderStatusChanged({
        userId: String(user.id),
        orderId: oid,
        storeName: this.storeNameFromPopulated(order.store),
        storeId: storeId ?? undefined,
        previousStatus: prevStatus,
        newStatus: OrderStatusEnum.CANCELLED,
        bodyOverride: 'Commande annulée — remboursement en cours d’examen',
      })
      .catch((err) =>
        this.logger.warn(
          `FCM cancel+refund: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );

    void this.notifyPartiesOrderRealtimeByOrderId(
      oid,
      OrderStatusEnum.CANCELLED,
    );

    return {
      orderId: oid,
      status: OrderRefundRequestEntryStatusEnum.PENDING,
    };
  }

  private assertRefundRequestApplicableToOrder(status: OrderStatusEnum): void {
    if (status === OrderStatusEnum.CREATED) {
      throw new BadRequestException('refund_not_applicable_unpaid');
    }
    if (status === OrderStatusEnum.CANCELLED) {
      throw new BadRequestException('refund_not_applicable_cancelled');
    }
    if (this.isRefundRequestAllowedForStatus(status)) {
      return;
    }
    if (
      status === OrderStatusEnum.APPROVED ||
      status === OrderStatusEnum.SHIPPED ||
      status === OrderStatusEnum.COMPLETED
    ) {
      throw new BadRequestException('refund_not_applicable_pending_delivery');
    }
    throw new BadRequestException('refund_not_applicable_status');
  }

  private assertRefundRequestNotBlockedByHistory(
    log: Array<{ status?: string }>,
  ): void {
    for (const row of log) {
      const s = String(row?.status ?? '');
      if (
        s === OrderRefundRequestEntryStatusEnum.PENDING ||
        s === OrderRefundRequestEntryStatusEnum.PAUSED
      ) {
        throw new BadRequestException('refund_request_pending');
      }
    }
    for (const row of log) {
      const s = String(row?.status ?? '');
      if (
        s === OrderRefundRequestEntryStatusEnum.APPROVED ||
        s === OrderRefundRequestEntryStatusEnum.COMPLETED
      ) {
        throw new BadRequestException('refund_already_processed');
      }
    }
  }

  /**
   * Snapshot suivi temps réel (client) : position livreur, progression, distance restante.
   */
  async getLiveTrackingForClient(
    orderId: string,
    user: UserModel,
  ): Promise<OrderWsTrackingPayload & { elapsedMinutes?: number }> {
    const order = await this.findOneById(orderId, user);
    const plain = order as unknown as Record<string, unknown>;
    const oid =
      (plain._id as { toString?: () => string })?.toString?.() ??
      String(plain.id ?? orderId);
    const status = String(plain.status ?? '') as OrderStatusEnum;
    const isPickup = this.isPickupOrder(
      plain as { shouldShip?: boolean; shippingPrice?: number },
    );
    const tracking = this.buildOrderTrackingPayload(plain, status);
    const elapsedMinutes = this.elapsedMinutesForOrder(plain);

    if (
      !isPickup &&
      status === OrderStatusEnum.SHIPPED &&
      Types.ObjectId.isValid(oid)
    ) {
      const driver = await this.findDeliveryDriverForOrder(oid);
      const storeCoords = this.coordsFromAddressLike(
        plain.store &&
          typeof plain.store === 'object' &&
          'address' in (plain.store as object)
          ? (plain.store as { address?: unknown }).address
          : undefined,
      );
      const userAddr = this.defaultUserAddressFromPopulated(plain.user);
      const userCoords = userAddr?.coords;

      if (
        driver &&
        typeof driver.latitude === 'number' &&
        typeof driver.longitude === 'number' &&
        storeCoords &&
        userCoords
      ) {
        const courierLat = driver.latitude;
        const courierLng = driver.longitude;
        const totalKm = +haversineDistance(storeCoords, userCoords).toFixed(2);
        const remainingKm = +haversineDistance(
          [courierLng, courierLat],
          userCoords,
        ).toFixed(2);
        const fromStore = +haversineDistance(storeCoords, [
          courierLng,
          courierLat,
        ]).toFixed(2);
        const progress =
          totalKm > 0
            ? Math.min(0.98, Math.max(0.1, fromStore / totalKm))
            : this.trackingProgressForStatus(status, false);

        return {
          ...tracking,
          distanceKm: totalKm,
          remainingDistanceKm: remainingKm,
          progress,
          courierLatitude: courierLat,
          courierLongitude: courierLng,
          elapsedMinutes,
        };
      }
    }

    const totalKm = tracking.distanceKm;
    const progress = tracking.progress ?? 0;
    const remainingDistanceKm =
      totalKm != null && Number.isFinite(totalKm)
        ? +Math.max(0, totalKm * (1 - progress)).toFixed(2)
        : undefined;

    return {
      ...tracking,
      remainingDistanceKm,
      elapsedMinutes,
    };
  }

  private elapsedMinutesForOrder(
    order: Record<string, unknown>,
  ): number | undefined {
    const events = (order.statusEvents ?? order.status_events) as
      | Array<Record<string, unknown>>
      | undefined;
    let start: Date | undefined;
    if (Array.isArray(events)) {
      for (const e of events) {
        const to = String(e.toStatus ?? e.to_status ?? '')
          .trim()
          .toLowerCase();
        if (to !== 'approved' && to !== 'shipped') continue;
        const raw = e.createdAt ?? e.created_at;
        const at =
          raw instanceof Date
            ? raw
            : typeof raw === 'string'
              ? new Date(raw)
              : null;
        if (at && !Number.isNaN(at.getTime())) {
          if (!start || at < start) start = at;
        }
      }
    }
    if (!start) {
      const c = order.createdAt ?? order.created_at;
      if (typeof c === 'string') start = new Date(c);
    }
    if (!start || Number.isNaN(start.getTime())) return undefined;
    const mins = Math.floor((Date.now() - start.getTime()) / 60000);
    return mins < 1 ? 1 : mins;
  }

  private async findDeliveryDriverForOrder(
    orderId: string,
  ): Promise<DeliveryDriverModel | null> {
    const tail = orderId.trim().slice(-6).toUpperCase();
    if (!tail) return null;
    const patterns = [
      `#AE-${tail}`,
      `AE-${tail}`,
      `CMD-${tail}`,
      tail,
    ];
    const doc = await this._deliveryDriverModel
      .findOne({
        statut: DeliveryDriverStatutEnum.EN_LIVRAISON,
        'commande_en_cours.id': { $in: patterns },
      })
      .select('latitude longitude commande_en_cours')
      .lean()
      .exec();
    return doc as DeliveryDriverModel | null;
  }
}
