import { StripeConnectTransferService } from '@modules/billing/stripe/stripe-connect-transfer.service';
import { BusinessReportsService } from '@modules/business-reports/business-reports.service';
import { AdsService } from '@modules/ads/ads.service';
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
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AddressModel } from '@schemas/address.schema';
import { CartItemModel, CartItemTypeEnum } from '@schemas/cart_item.schema';
import {
  OrdeLineItem,
  OrderModel,
  OrderRefundRequestEntryStatusEnum,
  OrderStatusEnum,
} from '@schemas/order.schema';
import { DeliveryAgentApplicationModel } from '@schemas/delivery-agent-application.schema';
import { StoreModel } from '@schemas/store.schema';
import { StripeProcessedCheckoutModel } from '@schemas/stripe-processed-checkout.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { haversineDistance } from 'src/utils/helpers';
import { mapInChunks } from '@utils/map-in-chunks';
import { OrderStatusChangeSourceEnum } from '@schemas/order-status-event.schema';
import {
  generatePickupCode,
  normalizePickupCodeInput,
} from 'src/utils/pickup-code';
import { objectIdStringFromRef } from 'src/utils/mongoose-ref.util';
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
import { WsChatNotifyService } from '@modules/ws-notify/ws-chat-notify.service';
import {
  WsOrderNotifyService,
  type OrderWsTrackingPayload,
} from '@modules/ws-notify/ws-order-notify.service';
import { LoyaltyService } from '@modules/loyalty/loyalty.service';
import { StoreAccessService } from '@modules/teams/store-access.service';
import { WsInboxNotifyService } from '@modules/ws-notify/ws-inbox-notify.service';
import {
  buildVendorOrderCreatedInboxMessage,
  buildVendorOrderPaidInboxMessage,
  buildVendorOrderPaidPushBody,
  buildVendorOrderStatusInboxMessage,
  buildVendorOrderStatusPush,
  vendorOrderStatusLabelFr,
  type VendorOrderNotifyReason,
} from './vendor-order-paid-message.util';
import { OrderPaidInvoiceEmailService } from './order-paid-invoice-email.service';
import {
  VendorStatusEmailService,
  type VendorOrderEmailEvent,
} from '@modules/vendor-emails/vendor-status-email.service';
import { VendorNotificationDispatchService } from '@modules/vendor-notifications/vendor-notification-dispatch.service';
import { vendorOrderReasonToCategory } from '@modules/vendor-notifications/vendor-notification.constants';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import type { RegionTaxLineResult } from '@modules/supported-countries/region-tax.constants';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  @InjectModel(OrderModel.name)
  private readonly _orderModel: Model<OrderModel>;

  @InjectModel(AddressModel.name)
  private readonly _addressModel: Model<AddressModel>;

  @InjectModel(UserModel.name)
  private readonly _userModel: Model<UserModel>;

  @InjectModel(StoreModel.name)
  private readonly _storeModel: Model<StoreModel>;

  @InjectModel(StripeProcessedCheckoutModel.name)
  private readonly _stripeProcessedCheckoutModel: Model<StripeProcessedCheckoutModel>;

  @InjectModel(DeliveryAgentApplicationModel.name)
  private readonly _deliveryAgentApplications: Model<DeliveryAgentApplicationModel>;

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

  @Inject(WsChatNotifyService)
  private readonly _wsChatNotify: WsChatNotifyService;

  @Inject(StoreAccessService)
  private readonly _storeAccess: StoreAccessService;

  @Inject(StripeConnectTransferService)
  private readonly _stripeTransfers: StripeConnectTransferService;

  @Inject(LoyaltyService)
  private readonly _loyaltyService: LoyaltyService;

  @Inject(AdsService)
  private readonly _adsService: AdsService;

  @Inject(WsInboxNotifyService)
  private readonly _wsInboxNotify: WsInboxNotifyService;

  @Inject(OrderPaidInvoiceEmailService)
  private readonly _orderPaidInvoiceEmail: OrderPaidInvoiceEmailService;

  @Inject(SupportedCountriesService)
  private readonly _supportedCountries: SupportedCountriesService;

  @Inject(VendorStatusEmailService)
  private readonly _vendorStatusEmail: VendorStatusEmailService;

  @Inject(VendorNotificationDispatchService)
  private readonly _vendorNotificationDispatch: VendorNotificationDispatchService;

  /** Expose l’adresse de livraison figée au paiement dans `user.addresses`. */
  static enrichOrdersWithDeliveryAddress(
    rows: Record<string, unknown>[],
  ): Record<string, unknown>[] {
    return rows.map((row) => OrdersService.enrichOrderWithDeliveryAddress(row));
  }

  private static enrichOrderWithDeliveryAddress(
    row: Record<string, unknown>,
  ): Record<string, unknown> {
    const shouldShip =
      row['shouldShip'] === true || row['should_ship'] === true;
    if (!shouldShip) return row;
    const snap =
      row['deliveryAddressSnapshot'] ?? row['delivery_address_snapshot'];
    if (!snap || typeof snap !== 'object') return row;
    const user = row['user'];
    if (!user || typeof user !== 'object') return row;
    const s = snap as Record<string, unknown>;
    const deliveryId =
      row['deliveryAddress'] ?? row['delivery_address'] ?? undefined;
    const addrDoc: Record<string, unknown> = {
      _id: deliveryId != null ? String(deliveryId) : undefined,
      id: deliveryId != null ? String(deliveryId) : undefined,
      label: s['label'],
      address: s['address'],
      city: s['city'],
      country: s['country'],
      countryCode: s['countryCode'] ?? s['country_code'],
      zipCode: s['zipCode'] ?? s['zip_code'],
      location: s['location'],
      isDefault: false,
    };
    return {
      ...row,
      user: {
        ...(user as Record<string, unknown>),
        addresses: [addrDoc],
      },
    };
  }

  /** Complète `order.currency` depuis `stripe_processed_checkouts` si absent. */
  private async enrichOrdersWithStripeCurrency(
    rows: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    if (!rows.length) return rows;

    const missingByPaymentId = new Map<string, number[]>();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rawCur = row['currency'];
      if (typeof rawCur === 'string' && rawCur.trim().length > 0) continue;
      const rawId =
        row['stripeParentPaymentId'] ?? row['stripe_parent_payment_id'];
      const paymentId = typeof rawId === 'string' ? rawId.trim() : '';
      if (!paymentId) continue;
      const idx = missingByPaymentId.get(paymentId) ?? [];
      idx.push(i);
      missingByPaymentId.set(paymentId, idx);
    }
    if (!missingByPaymentId.size) return rows;

    const docs = await this._stripeProcessedCheckoutModel
      .find({ sessionId: { $in: [...missingByPaymentId.keys()] } })
      .select('sessionId currency')
      .lean()
      .exec();

    const currencyByPaymentId = new Map<string, string>();
    for (const d of docs) {
      const sid = String(d.sessionId ?? '').trim();
      const cur = String(d.currency ?? '')
        .trim()
        .toUpperCase();
      if (!sid || !cur) continue;
      currencyByPaymentId.set(sid, cur);
    }
    if (!currencyByPaymentId.size) return rows;

    const out = [...rows];
    for (const [paymentId, indexes] of missingByPaymentId) {
      const cur = currencyByPaymentId.get(paymentId);
      if (!cur) continue;
      for (const i of indexes) {
        out[i] = { ...out[i], currency: cur };
      }
    }
    return out;
  }

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
          oid instanceof Types.ObjectId ? oid.toHexString() : String(oid);
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
    const asCustomerScope = Boolean(args.asCustomer);

    if (asCustomerScope) {
      filter['user'] = new Types.ObjectId(String(user.id));
      if (args.storeId) {
        filter['store'] = { _id: args.storeId };
      }
    } else if (user.type === UserTypeEnum.ADMIN) {
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

    let enriched = OrdersService.enrichOrdersWithDeliveryAddress(
      data as unknown as Record<string, unknown>[],
    );
    enriched = await this.enrichOrdersWithStripeCurrency(enriched);
    enriched = await this.attachClientOrderFlags(
      enriched,
      user,
      asCustomerScope,
    );
    if (
      !asCustomerScope &&
      (user.type === UserTypeEnum.VENDOR || user.type === UserTypeEnum.ADMIN)
    ) {
      enriched = this.attachDashboardOrderRefundFlags(enriched);
    }
    if (
      !asCustomerScope &&
      (user.type === UserTypeEnum.VENDOR || user.type === UserTypeEnum.DELIVERY)
    ) {
      enriched = this.stripPickupCodeForNonClients(enriched);
    }

    if (!asCustomerScope && user.type === UserTypeEnum.ADMIN) {
      await this.ensureHandoffCodesForAdminSupport(enriched);
    }

    return { data: enriched as unknown as OrderModel[] };
  }

  /** Génère les codes retrait/livraison manquants pour le support admin (liste commandes). */
  private async ensureHandoffCodesForAdminSupport(
    rows: Record<string, unknown>[],
  ): Promise<void> {
    if (!rows.length) return;
    await mapInChunks(rows, 6, async (row) => {
      await this.ensurePickupCodeForOrderDoc(row);
    });
  }

  /** Code retrait/livraison : visible client + admin support ; masqué vendeur / livreur. */
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
      const delivery = this.clientDeliveryAgentFlags(o);
      return {
        ...o,
        canRequestRefund: refund.canRequestRefund,
        refundRequestState: refund.refundRequestState,
        assignedDeliveryUserId: delivery.assignedDeliveryUserId,
      };
    });
  }

  /** Indicateurs mobile : signalement déjà envoyé, éligibilité remboursement. */
  private async attachClientOrderFlags(
    rows: Record<string, unknown>[],
    user: UserModel,
    asCustomerScope = false,
  ): Promise<Record<string, unknown>[]> {
    if ((user.type !== UserTypeEnum.USER && !asCustomerScope) || !rows.length) {
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
      const delivery = this.clientDeliveryAgentFlags(o);
      return {
        ...o,
        hasBusinessReport: reported.has(id),
        canRequestRefund: refund.canRequestRefund,
        refundRequestState: refund.refundRequestState,
        assignedDeliveryUserId: delivery.assignedDeliveryUserId,
        canMessageDeliveryAgent: delivery.canMessageDeliveryAgent,
        deliveryChatArchived: delivery.deliveryChatArchived,
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
    const byOrder = await this._orderStatusEvents.listTimelineByOrderIds(
      orderIds,
    );
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
    const log =
      ((order['refundRequestLog'] ?? order['refund_request_log']) as
        | Array<{ status?: string }>
        | undefined) ?? [];

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

  async findOneById(
    id: string,
    user: UserModel,
    opts?: { asCustomer?: boolean },
  ) {
    const filter: Record<string, unknown> = { _id: id };
    const asCustomerScope = Boolean(opts?.asCustomer);

    if (asCustomerScope) {
      filter['user'] = new Types.ObjectId(String(user.id));
    } else if (user.type === UserTypeEnum.ADMIN) {
      // accès à toute commande
    } else if (user.type === UserTypeEnum.VENDOR) {
      const rawStores = user.stores || [];
      const storeIds = rawStores.map((s: unknown) => {
        if (typeof s === 'object' && s !== null && '_id' in s) {
          return String((s as { _id: { toString: () => string } })._id);
        }
        return String(s);
      });
      const vendorUserId = new Types.ObjectId(String(user.id));
      if (storeIds.length) {
        filter['$or'] = [{ store: { $in: storeIds } }, { user: vendorUserId }];
      } else {
        // Un vendeur peut aussi consulter ses achats personnels (mode client).
        filter['user'] = vendorUserId;
      }
    } else if (user.type === UserTypeEnum.DELIVERY) {
      filter['assigned_delivery_user'] = new Types.ObjectId(String(user.id));
      filter['shouldShip'] = true;
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
    let row: Record<string, unknown> =
      OrdersService.enrichOrderWithDeliveryAddress(plain);
    if (user.type === UserTypeEnum.USER || asCustomerScope) {
      const [withFlags] = await this.attachClientOrderFlags(
        [plain],
        user,
        asCustomerScope,
      );
      row = withFlags;
    } else if (
      user.type === UserTypeEnum.VENDOR ||
      user.type === UserTypeEnum.ADMIN
    ) {
      row = this.attachDashboardOrderRefundFlags([plain])[0];
    }
    const [enriched] = await this.attachStatusEventsToOrders([row]);
    const [withCurrency] = await this.enrichOrdersWithStripeCurrency([
      enriched,
    ]);
    const out = withCurrency;
    if (
      asCustomerScope ||
      user.type === UserTypeEnum.USER ||
      user.type === UserTypeEnum.ADMIN
    ) {
      return out as unknown as typeof order;
    }
    return this.stripPickupCodeForNonClients([
      out,
    ])[0] as unknown as typeof order;
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

    const items: OrdeLineItem[] = await mapInChunks(
      cart.items,
      4,
      async (item) => {
        const e = item.entity as
          | { title?: string; name?: string; profileImage?: string }
          | undefined;
        const label = (e?.title || e?.name || 'Article').trim() || 'Article';
        const row = item as CartItemModel & {
          selectedComplements?: unknown;
          selectedSupplements?: unknown;
          selectedVariantLabel?: string;
        };
        const variantLabel = String(row.selectedVariantLabel ?? '').trim();
        return {
          label,
          itemType: item.type!,
          entityId: String(item.entityId ?? ''),
          pictureUrl: e?.profileImage,
          quantity: item.quantity!,
          price: item.price!,
          categoryTitle: await this.categoryTitleForCartLine(item),
          selectedComplements: Array.isArray(row.selectedComplements)
            ? row.selectedComplements
            : [],
          selectedSupplements: Array.isArray(row.selectedSupplements)
            ? row.selectedSupplements
            : [],
          ...(variantLabel ? { selectedVariantLabel: variantLabel } : {}),
        };
      },
    );

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

    const sname = storePop?.name?.trim() || 'Boutique';
    const orderIdStr = created._id.toString();
    const msgArgs = {
      orderId: orderIdStr,
      items: items as OrdeLineItem[],
      totalPrice: calculatedPrice,
      storeName: sname,
    };
    const itemCount = items.reduce(
      (s, i) => s + Math.max(1, Math.round(Number(i.quantity) || 1)),
      0,
    );
    void this.notifyStoreVendorsForOrder({
      storeId: String(storeId),
      customerUserId: String(user.id),
      inboxMessage: buildVendorOrderCreatedInboxMessage(msgArgs),
      push: {
        title: 'Nouvelle commande',
        body: `${sname} : nouvelle commande (en attente de paiement).`,
        orderId: orderIdStr,
        storeName: sname,
        reason: 'new_order',
        status: OrderStatusEnum.CREATED,
      },
      email: {
        event: 'new_order',
        orderId: orderIdStr,
        storeName: sname,
        totalPrice: calculatedPrice,
        itemCount,
        statusLabel: vendorOrderStatusLabelFr(OrderStatusEnum.CREATED),
      },
      logTag: 'new_order',
    });
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

  /** Ajoute une entrée `stores.vendor_messages` + refresh inbox WebSocket. */
  private async appendStoreVendorOrderMessage(
    storeId: string,
    message: string,
    notifyUserIds: string[],
  ): Promise<void> {
    const text = message.trim();
    if (!text || !Types.ObjectId.isValid(storeId)) return;
    await this._storeModel.updateOne(
      { _id: new Types.ObjectId(storeId) },
      {
        $push: {
          vendorMessages: {
            message: text,
            from: 'SYSTEM',
            createdAt: new Date(),
          },
        },
      },
    );
    for (const id of [...new Set(notifyUserIds)]) {
      this._wsInboxNotify.notifyUserInboxRefresh(id);
    }
  }

  /**
   * Notifie la boutique : message inbox toujours enregistré ; push FCM sauf pour le client commandeur.
   */
  private async notifyStoreVendorsForOrder(args: {
    storeId: string;
    customerUserId?: string | null;
    inboxMessage: string;
    push?: {
      title: string;
      body: string;
      orderId: string;
      storeName?: string;
      reason: string;
      status: string;
    };
    email?: {
      event: VendorOrderEmailEvent;
      orderId: string;
      storeName?: string;
      totalPrice?: number;
      currency?: string;
      itemCount?: number;
      note?: string;
      statusLabel?: string;
    };
    logTag: string;
  }): Promise<void> {
    const sid = args.storeId?.trim();
    if (!sid || !Types.ObjectId.isValid(sid)) return;

    const reason = args.push?.reason ?? args.email?.event ?? 'order';
    const category = vendorOrderReasonToCategory(reason);
    const emailPayload = args.email
      ? this._vendorStatusEmail.buildVendorOrderEmailPayload({
          storeId: sid,
          orderId: args.email.orderId,
          event: args.email.event,
          storeName: args.email.storeName ?? args.push?.storeName,
          totalPrice: args.email.totalPrice,
          currency: args.email.currency,
          itemCount: args.email.itemCount,
          note: args.email.note,
          statusLabel: args.email.statusLabel,
        })
      : undefined;

    void this._vendorNotificationDispatch.notifyStoreVendors({
      storeId: sid,
      category,
      customerUserId: args.customerUserId,
      push: args.push
        ? {
            title: args.push.title,
            body: args.push.body,
            orderId: args.push.orderId,
            storeName: args.push.storeName,
            reason: args.push.reason,
            status: args.push.status,
          }
        : undefined,
      email: emailPayload,
      smsBody: args.push?.body ?? emailPayload?.body,
      metadata: {
        orderId: args.push?.orderId ?? args.email?.orderId ?? '',
        reason,
      },
      logTag: args.logTag,
      onInbox: async (notifyUserIds) => {
        await this.appendStoreVendorOrderMessage(
          sid,
          args.inboxMessage,
          notifyUserIds,
        );
      },
    });
  }

  /**
   * Push + inbox + e-mail vendeur pour un changement de statut commande.
   */
  notifyStoreVendorsForOrderStatusChange(
    order: OrderModel,
    ctx: {
      reason: VendorOrderNotifyReason;
      status: OrderStatusEnum;
      note?: string;
      isPickup?: boolean;
      pushBodyOverride?: string;
    },
  ): void {
    const storeId = this.storeIdFromOrderDoc(order);
    if (!storeId) return;

    const storeName = this.storeNameFromPopulated(order.store);
    const orderIdStr = order._id.toString();
    const items = (order.items ?? []) as OrdeLineItem[];
    const totalPrice = Number(order.totalPrice) || 0;
    const currency =
      typeof order.currency === 'string' ? order.currency : undefined;
    const pickupCode =
      typeof order.pickupCode === 'string' ? order.pickupCode : undefined;
    const itemCount = items.reduce(
      (s, i) => s + Math.max(1, Math.round(Number(i.quantity) || 1)),
      0,
    );
    const msgArgs = {
      orderId: orderIdStr,
      items,
      totalPrice,
      currency,
      pickupCode,
      storeName,
    };
    const statusLabel = vendorOrderStatusLabelFr(
      ctx.status,
      ctx.isPickup ?? this.isPickupOrder(order),
    );
    const push = buildVendorOrderStatusPush({
      reason: ctx.reason,
      storeName,
      orderId: orderIdStr,
      totalPrice,
      currency,
      note: ctx.note,
      isPickup: ctx.isPickup ?? this.isPickupOrder(order),
      pushBodyOverride: ctx.pushBodyOverride,
    });
    const inbox =
      ctx.reason === 'order_paid'
        ? buildVendorOrderPaidInboxMessage(msgArgs)
        : ctx.reason === 'new_order'
          ? buildVendorOrderCreatedInboxMessage(msgArgs)
          : buildVendorOrderStatusInboxMessage({
              ...msgArgs,
              statusLabel,
              note: ctx.note,
            });

    void this.notifyStoreVendorsForOrder({
      storeId,
      customerUserId: this.userIdFromOrderDoc(order),
      inboxMessage: inbox,
      push: {
        title: push.title,
        body:
          ctx.reason === 'order_paid'
            ? buildVendorOrderPaidPushBody(msgArgs)
            : push.body,
        orderId: orderIdStr,
        storeName,
        reason: push.reason,
        status: ctx.status,
      },
      email: {
        event: ctx.reason,
        orderId: orderIdStr,
        storeName,
        totalPrice,
        currency,
        itemCount,
        note: ctx.note,
        statusLabel,
      },
      logTag: ctx.reason,
    });
  }

  /**
   * Après paiement Stripe : statut payé + frais + total.
   * Si `opts.charged*Cents` sont fournis (métadonnées Stripe / payout), le total
   * suit le montant réellement encaissé (ex. panier avec code promo).
   */
  private async deliveryAddressSnapshotForUser(
    customerUserId: string,
    addressId: string,
  ): Promise<OrderModel['deliveryAddressSnapshot'] | null> {
    const aid = addressId.trim();
    if (!aid) return null;
    const userDoc = await this._userModel
      .findById(customerUserId)
      .select('addresses')
      .lean()
      .exec();
    const addrRefs = (userDoc as { addresses?: unknown[] } | null)?.addresses;
    const owned = (addrRefs ?? []).some((ref) => ref?.toString() === aid);
    if (!owned) {
      this.logger.warn(
        `markOrderPaid: address ${aid} not owned by user ${customerUserId}`,
      );
      return null;
    }
    const addr = await this._addressModel.findById(aid).lean().exec();
    if (!addr) return null;
    const loc = addr.location as
      | { type?: string; coordinates?: number[] }
      | undefined;
    return {
      label: addr.label,
      address: addr.address,
      city: addr.city,
      country: addr.country,
      countryCode: addr.countryCode,
      zipCode: addr.zipCode,
      location:
        loc?.coordinates?.length === 2
          ? {
              type: loc.type ?? 'Point',
              coordinates: loc.coordinates,
            }
          : undefined,
    };
  }

  async markOrderPaidWithShipping(
    orderId: string,
    shippingPrice: number,
    opts?: {
      stripeParentPaymentId?: string;
      couponCode?: string;
      chargedGoodsCents?: number;
      chargedShipCents?: number;
      chargedTaxCents?: number;
      taxTotal?: number;
      taxLines?: RegionTaxLineResult[];
      taxCountryCode?: string;
      subtotalBeforeTax?: number;
      deliveryAddressId?: string;
      currency?: string;
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
    const tC =
      opts?.chargedTaxCents != null && Number.isFinite(opts.chargedTaxCents)
        ? Math.max(0, Math.round(opts.chargedTaxCents))
        : null;

    let taxTotal = Math.max(0, Number(opts?.taxTotal) || 0);
    let taxLines = Array.isArray(opts?.taxLines) ? opts!.taxLines : [];
    let taxCountryCode = String(opts?.taxCountryCode ?? '')
      .trim()
      .toUpperCase();
    let subtotalBeforeTax =
      opts?.subtotalBeforeTax != null
        ? Math.max(0, Number(opts.subtotalBeforeTax) || 0)
        : goods + ship;

    if (!taxLines.length && !taxTotal) {
      const customer = await this._userModel
        .findById(o.user)
        .select('appCountryCode')
        .lean()
        .exec();
      let deliveryCc: string | undefined;
      const aid = opts?.deliveryAddressId?.trim();
      if (aid) {
        const addr = await this._addressModel
          .findById(aid)
          .select('countryCode')
          .lean()
          .exec();
        deliveryCc = addr?.countryCode;
      } else if (o.deliveryAddressSnapshot?.countryCode) {
        deliveryCc = o.deliveryAddressSnapshot.countryCode;
      }
      const cc = this._supportedCountries.resolveUserTaxCountryCode(
        customer as UserModel,
        deliveryCc,
      );
      const breakdown = await this._supportedCountries.computeTaxesForModule({
        countryCode: cc,
        baseAmount: subtotalBeforeTax,
        module: 'order',
      });
      taxTotal = breakdown.taxTotal;
      taxLines = breakdown.lines;
      taxCountryCode = breakdown.countryCode;
    }

    let totalPrice: number;
    let shippingStored: number;
    if (gC != null && sC != null) {
      const taxPart = tC ?? Math.round(taxTotal * 100 + Number.EPSILON);
      totalPrice = Math.round(gC + sC + taxPart + Number.EPSILON) / 100;
      shippingStored = sC / 100;
    } else {
      shippingStored = ship;
      totalPrice =
        Math.round((subtotalBeforeTax + taxTotal) * 100 + Number.EPSILON) /
        100;
    }

    const isPickup = shippingStored <= 0;
    const $set: Record<string, unknown> = {
      status: OrderStatusEnum.PAIED,
      shippingPrice: shippingStored,
      totalPrice,
      subtotalBeforeTax,
      taxTotal,
      taxLines: taxLines.map((line) => ({
        name: line.name,
        description: line.description,
        feeType: line.feeType,
        feeValue: line.feeValue,
        modules: line.modules,
        amount: line.amount,
      })),
      taxCountryCode: taxCountryCode || undefined,
      shouldShip: !isPickup,
    };
    if (
      isPickup &&
      !(typeof o.pickupCode === 'string' && o.pickupCode.trim())
    ) {
      $set['pickupCode'] = generatePickupCode();
    }
    if (opts?.stripeParentPaymentId?.trim()) {
      $set['stripeParentPaymentId'] = opts.stripeParentPaymentId.trim();
    }
    if (opts?.couponCode?.trim()) {
      $set['couponCode'] = opts.couponCode.trim().toUpperCase();
    }
    if (opts?.currency?.trim()) {
      $set['currency'] = opts.currency.trim().toUpperCase();
    }
    if (gC != null) {
      $set['stripeChargedGoodsCents'] = gC;
    }
    if (sC != null) {
      $set['stripeChargedShipCents'] = sC;
    }

    if (!isPickup && opts?.deliveryAddressId?.trim()) {
      const customerId = (() => {
        const raw = o.user as unknown;
        if (raw instanceof Types.ObjectId) return raw.toHexString();
        if (raw && typeof raw === 'object' && '_id' in raw) {
          const uid = (raw as { _id: unknown })._id;
          return uid instanceof Types.ObjectId
            ? uid.toHexString()
            : String(uid);
        }
        return String(raw ?? '');
      })();
      const snap = await this.deliveryAddressSnapshotForUser(
        customerId,
        opts.deliveryAddressId,
      );
      if (snap) {
        $set['deliveryAddress'] = new Types.ObjectId(
          opts.deliveryAddressId.trim(),
        );
        $set['deliveryAddressSnapshot'] = snap;
      }
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
      const uid = objectIdStringFromRef(o.user);
      let storeName: string | undefined;
      const rawStore = o.store as unknown;
      if (rawStore && typeof rawStore === 'object' && 'name' in rawStore) {
        const nm = (rawStore as { name?: unknown }).name;
        if (typeof nm === 'string' && nm.trim()) {
          storeName = nm.trim();
        }
      }
      const storeIdForCustomer = objectIdStringFromRef(o.store);
      if (uid && Types.ObjectId.isValid(uid)) {
        void this._notificationsService
          .pushCustomerOrderStatusChanged({
            userId: uid,
            orderId,
            storeName,
            storeId: storeIdForCustomer,
            previousStatus: prevStatus,
            newStatus: OrderStatusEnum.PAIED,
          })
          .catch((err) =>
            this.logger.warn(
              `FCM order paid: ${
                err instanceof Error ? err.message : String(err)
              }`,
            ),
          );
      }
      void this.notifyPartiesOrderRealtimeByOrderId(
        orderId,
        OrderStatusEnum.PAIED,
      );

      void this._orderPaidInvoiceEmail
        .sendForPaidOrder(orderId)
        .catch((err) =>
          this.logger.warn(
            `order paid invoice email order=${orderId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );

      // Fidélité : crédit dès encaissement confirmé (respecte éligibilité + réglages admin).
      void this._loyaltyService
        .creditOrderCompletion(orderId)
        .catch((err) =>
          this.logger.warn(
            `Loyalty credit on paid order=${orderId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );

      const paidItemRefs = (o.items as OrdeLineItem[])
        .map((item) => ({
          itemType: String(item.itemType ?? ''),
          entityId: String(item.entityId ?? '').trim(),
        }))
        .filter(
          (item) =>
            (item.itemType === CartItemTypeEnum.PRODUCT ||
              item.itemType === CartItemTypeEnum.DRINK) &&
            Types.ObjectId.isValid(item.entityId),
        );
      const storeIdForAds = objectIdStringFromRef(o.store);
      if (uid && storeIdForAds && paidItemRefs.length > 0) {
        void this._adsService
          .trackOrderConversions({
            orderId,
            userId: uid,
            storeId: storeIdForAds,
            items: paidItemRefs,
          })
          .catch((err) =>
            this.logger.warn(
              `Ads conversion tracking failed for order=${orderId}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            ),
          );
      }
    }

    void this.ensureVendorPaidOrderNotifications(orderId).catch((err) =>
      this.logger.warn(
        `vendor paid notify order=${orderId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    );
  }

  /**
   * E-mail client « commande en livraison » (balisage Schema.org OrderInTransit).
   * Non bloquant : les erreurs sont seulement journalisées.
   */
  sendShippedInvoiceEmail(orderId: string): void {
    void this._orderPaidInvoiceEmail
      .sendForShippedOrder(orderId)
      .catch((err) =>
        this.logger.warn(
          `order shipped email order=${orderId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
  }

  /**
   * Message inbox + push vendeur après paiement. Idempotent (`vendorPaidNotifiedAt`).
   * Rattrape les retry Stripe où la commande est déjà `paied` sans notification.
   */
  async ensureVendorPaidOrderNotifications(orderId: string): Promise<void> {
    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) return;

    const order = await this._orderModel
      .findOne({
        _id: new Types.ObjectId(oid),
        status: OrderStatusEnum.PAIED,
        vendorPaidNotifiedAt: { $exists: false },
      })
      .populate('store', 'name')
      .lean()
      .exec();
    if (!order) {
      return;
    }

    const storeId = objectIdStringFromRef(order.store);
    if (!storeId) {
      this.logger.warn(
        `ensureVendorPaidOrderNotifications: storeId missing order=${oid}`,
      );
      return;
    }

    let storeName: string | undefined;
    const rawStore = order.store as unknown;
    if (rawStore && typeof rawStore === 'object' && 'name' in rawStore) {
      const nm = (rawStore as { name?: unknown }).name;
      if (typeof nm === 'string' && nm.trim()) {
        storeName = nm.trim();
      }
    }

    const paidMsgArgs = {
      orderId: oid,
      items: (order.items ?? []) as OrdeLineItem[],
      totalPrice: Number(order.totalPrice) || 0,
      currency:
        typeof order.currency === 'string' ? order.currency : undefined,
      pickupCode:
        typeof order.pickupCode === 'string' ? order.pickupCode : undefined,
      storeName,
    };

    const paidItemCount = (order.items ?? []).reduce(
      (s, i) => s + Math.max(1, Math.round(Number(i.quantity) || 1)),
      0,
    );
    await this.notifyStoreVendorsForOrder({
      storeId,
      customerUserId: objectIdStringFromRef(order.user),
      inboxMessage: buildVendorOrderPaidInboxMessage(paidMsgArgs),
      push: {
        title: 'Commande payée',
        body: buildVendorOrderPaidPushBody(paidMsgArgs),
        orderId: oid,
        storeName,
        reason: 'order_paid',
        status: OrderStatusEnum.PAIED,
      },
      email: {
        event: 'order_paid',
        orderId: oid,
        storeName,
        totalPrice: Number(order.totalPrice) || 0,
        currency:
          typeof order.currency === 'string' ? order.currency : undefined,
        itemCount: paidItemCount,
        statusLabel: vendorOrderStatusLabelFr(OrderStatusEnum.PAIED),
      },
      logTag: 'order_paid',
    });

    await this._orderModel
      .updateOne(
        {
          _id: new Types.ObjectId(oid),
          vendorPaidNotifiedAt: { $exists: false },
        },
        { $set: { vendorPaidNotifiedAt: new Date() } },
      )
      .exec();
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
      .updateOne(
        { _id: new Types.ObjectId(oid) },
        { $set: { pickupCode: code } },
      )
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
            `FCM order ready: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
    }

    await this.ensurePickupCodeForOrderDoc(order);
    this.notifyPartiesOrderRealtimeFromDoc(order, OrderStatusEnum.APPROVED);
    this.notifyStoreVendorsForOrderStatusChange(order, {
      reason: 'order_ready',
      status: OrderStatusEnum.APPROVED,
      isPickup,
      note: isPickup ? 'Prête pour retrait' : 'Prête pour livraison',
    });

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
      user.type === UserTypeEnum.ADMIN
        ? ('admin' as const)
        : ('vendor' as const);

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

    const parentId = String(
      (order as { stripeParentPaymentId?: string }).stripeParentPaymentId ?? '',
    ).trim();
    const wasPaid =
      prevStatus === OrderStatusEnum.PAIED ||
      prevStatus === OrderStatusEnum.APPROVED ||
      prevStatus === OrderStatusEnum.SHIPPED ||
      prevStatus === OrderStatusEnum.COMPLETED;
    if (
      wasPaid &&
      parentId.length > 0 &&
      !this.hasActiveRefundRequest(order.refundRequestLog)
    ) {
      const autoDetails =
        source === 'vendor'
          ? 'Annulation par le restaurant — remboursement client intégral (sans frais plateforme).'
          : source === 'admin'
          ? 'Annulation par l’administration — remboursement à traiter.'
          : 'Annulation — remboursement à traiter.';
      order.refundRequestLog = [
        ...(order.refundRequestLog ?? []),
        {
          status: OrderRefundRequestEntryStatusEnum.PENDING,
          details: autoDetails,
          requestedAt: new Date(),
        },
      ];
    }

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
            `FCM order reject: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
    }

    void this.notifyPartiesOrderRealtimeByOrderId(
      oid,
      OrderStatusEnum.CANCELLED,
    );
    this.notifyStoreVendorsForOrderStatusChange(order, {
      reason: 'order_cancelled',
      status: OrderStatusEnum.CANCELLED,
      note: resolved.details,
    });

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

  private deliveryAddressFromOrder(order: Record<string, unknown>): {
    line?: string;
    coords?: [number, number];
    raw?: Record<string, unknown>;
  } | null {
    const snap =
      order['deliveryAddressSnapshot'] ?? order['delivery_address_snapshot'];
    if (!snap || typeof snap !== 'object') return null;
    const doc = snap as Record<string, unknown>;
    const coords = this.coordsFromAddressLike(doc);
    const street = String(doc.address ?? '').trim();
    const city = String(doc.city ?? '').trim();
    const zip = String(doc.zipCode ?? doc.zip_code ?? '').trim();
    const parts = [
      street,
      [city, zip].filter((s) => s.length > 0).join(' '),
    ].filter((s) => s.length > 0);
    const line = parts.join(', ');
    if (!line && !coords) return null;
    return { line: line || undefined, coords, raw: doc };
  }

  private resolveOrderTrackingGeo(
    order: OrderModel | Record<string, unknown>,
    isPickup: boolean,
  ): {
    distanceKm?: number;
    destinationLine?: string;
    originLine?: string;
  } {
    const orderRec = order as Record<string, unknown>;
    const store = orderRec.store;
    const user = orderRec.user;

    const storeCoords = this.coordsFromAddressLike(
      store && typeof store === 'object' && 'address' in store
        ? (store as { address?: unknown }).address
        : undefined,
    );
    const userAddr =
      this.deliveryAddressFromOrder(orderRec) ??
      this.defaultUserAddressFromPopulated(user);
    const userCoords = userAddr?.coords;

    let distanceKm: number | undefined;
    if (storeCoords && userCoords) {
      distanceKm = +haversineDistance(userCoords, storeCoords)?.toFixed(2);
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

  private coordsFromAddressLike(addr: unknown): [number, number] | undefined {
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
    const delivery = this.clientDeliveryAgentFlags(
      order as Record<string, unknown>,
    );
    const tracking: OrderWsTrackingPayload = {
      ...this.buildOrderTrackingPayload(order, status),
      ...extra,
      ...(delivery.assignedDeliveryUserId
        ? { assignedDeliveryUserId: delivery.assignedDeliveryUserId }
        : {}),
      canMessageDeliveryAgent: delivery.canMessageDeliveryAgent,
      deliveryChatArchived: delivery.deliveryChatArchived,
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
    const deliveryAgentId = this.assignedDeliveryUserIdFromOrderDoc(order);
    if (
      deliveryAgentId &&
      deliveryAgentId !== customerId &&
      deliveryAgentId !== vendorId
    ) {
      this._wsOrderNotify.notifyCustomerOrderUpdate(deliveryAgentId, tracking);
      this._wsOrderNotify.notifyCustomerOrderTracking(
        deliveryAgentId,
        tracking,
      );
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
      .updateOne(
        { _id: new Types.ObjectId(oid) },
        { $set: { pickupCode: code } },
      )
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

    if (user.type === UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_cannot_confirm_handoff');
    }

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
    const expected = normalizePickupCodeInput(String(order.pickupCode ?? ''));
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
            `FCM order completed: ${
              err instanceof Error ? err.message : String(err)
            }`,
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
    this.notifyStoreVendorsForOrderStatusChange(order, {
      reason: 'order_completed',
      status: OrderStatusEnum.COMPLETED,
      isPickup,
      note: isPickup ? 'Retrait confirmé' : 'Livraison confirmée',
    });

    void this._loyaltyService
      .creditOrderCompletion(oid)
      .catch((err) =>
        this.logger.warn(
          `Loyalty credit order=${oid}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );

    if (!isPickup && order.shouldShip === true) {
      void this._wsChatNotify.archiveOrderDeliveryChats(oid);
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

  /** Indicateurs chat client ↔ livreur (commande livraison avec livreur assigné). */
  private clientDeliveryAgentFlags(order: Record<string, unknown>): {
    assignedDeliveryUserId: string | null;
    canMessageDeliveryAgent: boolean;
    deliveryChatArchived: boolean;
  } {
    const agentId = this.assignedDeliveryUserIdFromOrderDoc(order);
    const shouldShip =
      order['shouldShip'] === true || order['should_ship'] === true;
    if (!shouldShip || !agentId) {
      return {
        assignedDeliveryUserId: agentId,
        canMessageDeliveryAgent: false,
        deliveryChatArchived: false,
      };
    }
    const status = String(order['status'] ?? '')
      .trim()
      .toLowerCase();
    const archived = status === 'completed';
    const canMessage = ['approved', 'shipped', 'completed'].includes(status);
    return {
      assignedDeliveryUserId: agentId,
      canMessageDeliveryAgent: canMessage,
      deliveryChatArchived: archived,
    };
  }

  private assignedDeliveryUserIdFromOrderDoc(
    order: OrderModel | Record<string, unknown>,
  ): string | null {
    const raw =
      (order as OrderModel).assignedDeliveryUser ??
      (order as Record<string, unknown>).assigned_delivery_user ??
      (order as Record<string, unknown>).assignedDeliveryUser;
    if (raw == null) return null;
    if (typeof raw === 'object' && '_id' in (raw as object)) {
      const id = String((raw as { _id: unknown })._id).trim();
      return id.length > 0 ? id : null;
    }
    const id = String(raw).trim();
    return id.length > 0 ? id : null;
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
      .select(
        'status shouldShip refundRequestLog store items totalPrice currency pickupCode user',
      )
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
          `FCM cancel+refund: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );

    void this.notifyPartiesOrderRealtimeByOrderId(
      oid,
      OrderStatusEnum.CANCELLED,
    );
    this.notifyStoreVendorsForOrderStatusChange(order, {
      reason: 'order_cancelled',
      status: OrderStatusEnum.CANCELLED,
      note: `Annulation client : ${resolved.details}`,
    });

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

  private hasActiveRefundRequest(
    log: Array<{ status?: string }> | undefined,
  ): boolean {
    if (!log?.length) return false;
    return log.some((row) => {
      const s = String(row?.status ?? '');
      return (
        s === OrderRefundRequestEntryStatusEnum.PENDING ||
        s === OrderRefundRequestEntryStatusEnum.PAUSED ||
        s === OrderRefundRequestEntryStatusEnum.APPROVED
      );
    });
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
      const storeCoords = this.coordsFromAddressLike(
        plain.store &&
          typeof plain.store === 'object' &&
          'address' in (plain.store as object)
          ? (plain.store as { address?: unknown }).address
          : undefined,
      );
      const userAddr =
        this.deliveryAddressFromOrder(plain) ??
        this.defaultUserAddressFromPopulated(plain.user);
      const userCoords = userAddr?.coords;
      const courier = await this.resolveShippedCourierCoordinates(oid, plain);

      if (courier && storeCoords && userCoords) {
        const courierLat = courier.latitude;
        const courierLng = courier.longitude;
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

  /**
   * Pousse la position du livreur mobile sur la commande expédiée (WS + polling client).
   */
  async publishCourierPosition(
    orderId: string,
    courierLat: number,
    courierLng: number,
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

    const plain = order.toObject() as Record<string, unknown>;
    const status = String(plain.status ?? '') as OrderStatusEnum;
    if (status !== OrderStatusEnum.SHIPPED) return;

    const extra = this.buildShippedCourierTrackingExtra(
      plain,
      courierLat,
      courierLng,
      status,
    );
    if (!extra) return;
    this.notifyPartiesOrderRealtimeFromDoc(order, status, extra);
  }

  private buildShippedCourierTrackingExtra(
    plain: Record<string, unknown>,
    courierLat: number,
    courierLng: number,
    status: OrderStatusEnum,
  ): Partial<OrderWsTrackingPayload> | null {
    const storeCoords = this.coordsFromAddressLike(
      plain.store &&
        typeof plain.store === 'object' &&
        'address' in (plain.store as object)
        ? (plain.store as { address?: unknown }).address
        : undefined,
    );
    const userAddr = this.defaultUserAddressFromPopulated(plain.user);
    const userCoords = userAddr?.coords;
    if (!storeCoords || !userCoords) return null;

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
      distanceKm: totalKm,
      remainingDistanceKm: remainingKm,
      progress,
      courierLatitude: courierLat,
      courierLongitude: courierLng,
    };
  }

  private async resolveShippedCourierCoordinates(
    orderId: string,
    plain: Record<string, unknown>,
  ): Promise<{ latitude: number; longitude: number } | null> {
    const agentId = this.assignedDeliveryUserIdFromOrderDoc(plain);
    if (!agentId || !Types.ObjectId.isValid(agentId)) return null;

    const app = await this._deliveryAgentApplications
      .findOne({ user: new Types.ObjectId(agentId) })
      .select('lastLatitude lastLongitude')
      .lean()
      .exec();
    if (
      app &&
      typeof app.lastLatitude === 'number' &&
      typeof app.lastLongitude === 'number'
    ) {
      return { latitude: app.lastLatitude, longitude: app.lastLongitude };
    }
    return null;
  }
}
