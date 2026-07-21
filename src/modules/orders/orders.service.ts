import { isStripeConnectOnboardingCompleteUser } from '@modules/billing/stripe/stripe-connect-visibility';
import { StripeConnectTransferService } from '@modules/billing/stripe/stripe-connect-transfer.service';
import { StripeDeferredCaptureService } from '@modules/billing/stripe/stripe-deferred-capture.service';
import { BusinessReportsService } from '@modules/business-reports/business-reports.service';
import { AdsService } from '@modules/ads/ads.service';
import { CartService } from '@modules/cart/cart.service';
import {
  normalizeSelectedComplements,
  normalizeSelectedSupplements,
  normalizeSelectedVariantLabel,
} from '@modules/cart/cart-customization.util';
import {
  normalizeOrderItemsOnOrderRow,
  normalizeOrderItemsOnOrderRows,
} from './order-line-items-normalize.util';
import { resolveGiftOrderParties } from './gift-order.util';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { ProductsService } from '@modules/products/products.service';
import { RatingsService } from '@modules/ratings/ratings.service';
import type { CreateCourierOrderRatingDto } from '@modules/ratings/dto/courier-order-rating.dto';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { OrderDomainBridgeService } from '@modules/domain-event-handlers/order-domain-bridge.service';
import { WsOrderNotifyHandler } from '@modules/domain-event-handlers/handlers/ws-order-notify.handler';
import { ConfigService } from '@nestjs/config';
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
import {
  courierTelemetryWsFields,
  normalizeCourierLiveTelemetry,
  type CourierLiveTelemetry,
} from '@common/courier-live-telemetry.util';
import {
  fromStripeMinorUnits,
  stripeAmountFactor,
  toStripeMinorUnits,
} from '@utils/stripe-currency-amount.util';
import { OrderStatusChangeSourceEnum } from '@schemas/order-status-event.schema';
import {
  generatePickupCode,
  normalizePickupCodeInput,
} from 'src/utils/pickup-code';
import { objectIdStringFromRef, mongoIdsEqual } from 'src/utils/mongoose-ref.util';
import {
  canClientCancelPaidPreOrder,
  enrichOrdersDisplayStatus,
  readOrderIsPreOrder,
  readOrderPayOnPickup,
  readVendorAcceptedAt,
} from './order-display-status.util';
import {
  isOrderStatusCancellablePayOnPickup,
  isOrderStatusPaidForVendorWorkflow,
} from './order-status-workflow.util';
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
import { OrderStatusEventsService, RecordOrderStatusChangeParams } from './order-status-events.service';
import { WsChatNotifyService } from '@modules/ws-notify/ws-chat-notify.service';
import { type OrderWsTrackingPayload } from '@modules/ws-notify/ws-order-notify.service';
import { LoyaltyService } from '@modules/loyalty/loyalty.service';
import { StoreAccessService } from '@modules/teams/store-access.service';
import { WsInboxNotifyService } from '@modules/ws-notify/ws-inbox-notify.service';
import { DeliveryAgentService } from '@modules/delivery-agent/delivery-agent.service';
import { CourierMarketplaceDispatchService } from '@modules/delivery-agent/courier-marketplace-dispatch.service';
import { CourierPerformanceStatsService } from '@modules/delivery-agent/courier-performance-stats.service';
import { courierClaimStaleStateUnset } from '@modules/delivery-agent/delivery-agent-capacity.util';
import {
  buildVendorOrderCreatedInboxMessage,
  buildVendorOrderCreatedPushBody,
  buildVendorOrderPaidInboxMessage,
  buildVendorOrderPaidPushBody,
  buildVendorPreOrderDDayInboxMessage,
  buildVendorPreOrderDDayPushBody,
  buildVendorPreOrderReminderInboxMessage,
  buildVendorPreOrderReminderPushBody,
  buildVendorOrderPayOnPickupInboxMessage,
  buildVendorOrderPayOnPickupPushBody,
  buildVendorOrderStatusInboxMessage,
  buildVendorOrderStatusPush,
  vendorOrderStatusLabelFr,
  type VendorOrderNotifyReason,
} from './vendor-order-paid-message.util';
import {
  buildAdminOrderNoteInboxMessage,
  buildAdminOrderNotePush,
  normalizeAdminOrderNote,
} from './admin-order-note.util';
import {
  buildCustomerOrderNoteInboxMessage,
  buildCustomerOrderNotePush,
  customerOrderNoteAllowedStatuses,
  normalizeCustomerOrderNote,
} from './customer-order-note.util';
import { OrderPaidInvoiceEmailService } from './order-paid-invoice-email.service';
import { orderInvoiceRef } from './order-invoice.util';
import {
  VendorStatusEmailService,
  type VendorOrderEmailEvent,
} from '@modules/vendor-emails/vendor-status-email.service';
import { VendorNotificationDispatchService } from '@modules/vendor-notifications/vendor-notification-dispatch.service';
import { vendorOrderReasonToCategory } from '@modules/vendor-notifications/vendor-notification.constants';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import type { RegionTaxLineResult } from '@modules/supported-countries/region-tax.constants';
import {
  resolveStoreTaxCountryCode,
  resolveTaxCountryCode,
} from '@modules/supported-countries/region-tax.util';
import {
  CourierGpsThrottle,
  readCourierGpsThrottleConfig,
} from './courier-gps-throttle';
import { ModuleCacheLayerService } from '@common/cache/module-cache-layer.service';
import { domainEventIdFromCourierTracking } from '../../common/domain-events/domain-event-id.util';
import { GraphSyncQueueService } from '@modules/graph/graph-sync-queue.service';
import { buildGraphOrderCompletedPayload } from '@modules/graph/graph-order-payload.util';
import { DeliveryOrderOfferService } from '@modules/delivery-order-offer/delivery-order-offer.service';

import dayjs = require('dayjs');
import utc = require('dayjs/plugin/utc');

dayjs.extend(utc);

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private readonly courierGpsThrottle = new CourierGpsThrottle(
    readCourierGpsThrottleConfig(),
  );

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

  @Inject(forwardRef(() => WsOrderNotifyHandler))
  @Optional()
  private readonly _wsOrderNotifyHandler?: WsOrderNotifyHandler;

  @Inject(WsChatNotifyService)
  private readonly _wsChatNotify: WsChatNotifyService;

  @Inject(StoreAccessService)
  private readonly _storeAccess: StoreAccessService;

  @Inject(StripeConnectTransferService)
  private readonly _stripeTransfers: StripeConnectTransferService;

  @Inject(StripeDeferredCaptureService)
  private readonly _stripeDeferredCapture: StripeDeferredCaptureService;

  @Inject(LoyaltyService)
  private readonly _loyaltyService: LoyaltyService;

  @Inject(AdsService)
  private readonly _adsService: AdsService;

  @Inject(WsInboxNotifyService)
  private readonly _wsInboxNotify: WsInboxNotifyService;

  @Inject(forwardRef(() => DeliveryAgentService))
  private readonly _deliveryAgentService: DeliveryAgentService;

  @Inject(OrderPaidInvoiceEmailService)
  private readonly _orderPaidInvoiceEmail: OrderPaidInvoiceEmailService;

  @Inject(SupportedCountriesService)
  private readonly _supportedCountries: SupportedCountriesService;

  @Inject(VendorStatusEmailService)
  private readonly _vendorStatusEmail: VendorStatusEmailService;

  @Inject(VendorNotificationDispatchService)
  private readonly _vendorNotificationDispatch: VendorNotificationDispatchService;

  @Inject(ModuleCacheLayerService)
  private readonly _cacheLayer: ModuleCacheLayerService;

  @Inject(forwardRef(() => OrderDomainBridgeService))
  @Optional()
  private readonly _orderDomainBridge?: OrderDomainBridgeService;

  @Inject(ConfigService)
  private readonly _config: ConfigService;

  @Inject(RatingsService)
  private readonly _ratingsService: RatingsService;

  @Inject(forwardRef(() => GraphSyncQueueService))
  @Optional()
  private readonly _graphSyncQueue?: GraphSyncQueueService;

  @Inject(forwardRef(() => DeliveryOrderOfferService))
  @Optional()
  private readonly _deliveryOrderOffers?: DeliveryOrderOfferService;

  @Inject(forwardRef(() => CourierMarketplaceDispatchService))
  @Optional()
  private readonly _marketplaceDispatch?: CourierMarketplaceDispatchService;

  @Inject(forwardRef(() => CourierPerformanceStatsService))
  @Optional()
  private readonly _courierPerfStats?: CourierPerformanceStatsService;

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
    select: 'fullName email phoneNumber profileImage username addresses',
    populate: { path: 'addresses' },
  } as const;

  /** Offreur (commande cadeau) — lecture seule liste/détail. */
  private static readonly orderPaidByPopulate = {
    path: 'paidBy',
    select: 'fullName username profileImage',
  } as const;

  /** Projection minimale GPS livreur (OPT-002) — store + adresses sans populate lourd. */
  private static readonly orderTrackingCourierPopulate: {
    path: string;
    select?: string;
    populate?: { path: string; select?: string };
  }[] = [
    {
      path: 'store',
      select: 'owner name',
      populate: {
        path: 'address',
        select: 'address city zipCode location coordinates',
      },
    },
    {
      path: 'user',
      select: 'addresses',
      populate: {
        path: 'addresses',
        select: 'address city zipCode location coordinates isDefault',
      },
    },
  ];

  private static readonly orderTrackingCourierSelect =
    '_id status shouldShip shippingPrice assignedDeliveryUser deliveryAddressSnapshot';

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
    const meOid = new Types.ObjectId(String(user.id));
    // Filtre « Cadeaux » : commandes que j’ai payées pour un autre.
    const giftedByMe = Boolean(args.giftedByMe) && asCustomerScope;

    if (giftedByMe) {
      filter['paidBy'] = meOid;
      // Exclut edge cases où paidBy == user (ne devrait pas arriver).
      filter['user'] = { $ne: meOid };
      if (args.storeId) {
        filter['store'] = { _id: args.storeId };
      }
    } else if (asCustomerScope) {
      filter['user'] = meOid;
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
      filter['user'] = meOid;
      if (args.storeId) {
        filter['store'] = { _id: args.storeId };
      }
    }

    if (args.status) {
      filter['status'] = args.status;
    }

    if (args.isPreOrder === true) {
      filter['isPreOrder'] = true;
    } else if (args.isPreOrder === false) {
      filter['isPreOrder'] = { $ne: true };
    }

    const tomorrowStartUtc = dayjs().utc().add(1, 'day').startOf('day').toDate();

    if (args.preOrderFuture === true) {
      filter['isPreOrder'] = true;
      filter['scheduledAt'] = { $gte: tomorrowStartUtc };
    }

    if (args.excludeFuturePreOrders === true) {
      const futurePreOrderClause = {
        isPreOrder: true,
        scheduledAt: { $gte: tomorrowStartUtc },
      };
      const existingOr = filter['$or'];
      if (Array.isArray(existingOr)) {
        filter['$and'] = [
          { $or: existingOr },
          { $nor: [futurePreOrderClause] },
        ];
        delete filter['$or'];
      } else {
        filter['$nor'] = [futurePreOrderClause];
      }
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

    const sortField =
      args.sortBy === 'scheduledAt' ? 'scheduledAt' : 'createdAt';

    const data = await this._orderModel
      .find(filter)
      .sort({ [sortField]: -1 })
      .skip(skip)
      .limit(lim)
      .populate({
        path: 'store',
        select:
          'name profileImage status currency acceptsOrders supportsShipping acceptsPickupPayOnDelivery defaultPickupPayOnPickup bio',
        populate: {
          path: 'address',
          select: 'address city country countryCode zipCode label location',
        },
      })
      .populate(OrdersService.orderUserWithAddressesPopulate)
      .populate(OrdersService.orderPaidByPopulate)
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

    if (asCustomerScope || user.type === UserTypeEnum.USER) {
      enriched = enrichOrdersDisplayStatus(enriched);
    }

    // Lean Mongo : forcer camelCase perso avant field-selection.
    enriched = normalizeOrderItemsOnOrderRows(enriched);

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

  /** Vendeur : nom + adresse livraison uniquement (pas e-mail / téléphone client). */
  private static stripCustomerContactForVendor(
    row: Record<string, unknown>,
  ): Record<string, unknown> {
    const user = row['user'];
    if (!user || typeof user !== 'object') return row;
    const u = { ...(user as Record<string, unknown>) };
    delete u['email'];
    delete u['phoneNumber'];
    return { ...row, user: u };
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
        canCancelOrder: refund.canCancelOrder === true,
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
    canCancelOrder?: boolean;
  } {
    const status = String(order['status'] ?? '');
    if (
      readOrderIsPreOrder(order) &&
      status === OrderStatusEnum.CREATED
    ) {
      return {
        canRequestRefund: false,
        refundRequestState: 'unavailable',
        canCancelOrder: true,
      };
    }
    if (
      readOrderPayOnPickup(order) &&
      isOrderStatusCancellablePayOnPickup(status)
    ) {
      return {
        canRequestRefund: false,
        refundRequestState: 'unavailable',
        canCancelOrder: true,
      };
    }
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
    if (canClientCancelPaidPreOrder(order)) {
      return { canRequestRefund: true, refundRequestState: 'eligible' };
    }
    if (this.isRefundRequestAllowedForStatus(status)) {
      if (readOrderIsPreOrder(order)) {
        return {
          canRequestRefund: false,
          refundRequestState: 'unavailable',
        };
      }
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
    const meOid = new Types.ObjectId(String(user.id));

    if (asCustomerScope) {
      // Destinataire ou offreur (commande cadeau) peuvent ouvrir le détail.
      filter['$or'] = [{ user: meOid }, { paidBy: meOid }];
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
      const vendorUserId = meOid;
      if (storeIds.length) {
        filter['$or'] = [
          { store: { $in: storeIds } },
          { user: vendorUserId },
          { paidBy: vendorUserId },
        ];
      } else {
        // Un vendeur peut aussi consulter ses achats personnels (mode client).
        filter['$or'] = [{ user: vendorUserId }, { paidBy: vendorUserId }];
      }
    } else if (user.type === UserTypeEnum.DELIVERY) {
      filter['assignedDeliveryUser'] = meOid;
      filter['shouldShip'] = true;
    } else {
      filter['$or'] = [{ user: meOid }, { paidBy: meOid }];
    }

    const order = await this._orderModel
      .findOne(filter)
      .populate({
        path: 'store',
        select: 'name currency profileImage address',
        populate: [
          {
            path: 'address',
          },
        ],
      })
      .populate(OrdersService.orderUserWithAddressesPopulate)
      .populate(OrdersService.orderPaidByPopulate)
      .exec();

    if (!order) {
      throw new NotFoundException('order_not_found');
    }

    await this.ensurePickupCodeForOrderDoc(order);

    // getters + normalize perso (camel) avant field-selection interceptor.
    const plain = normalizeOrderItemsOnOrderRow(
      order.toObject() as Record<string, unknown>,
    );
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
    let out = withCurrency;
    if (asCustomerScope || user.type === UserTypeEnum.USER) {
      out = enrichOrdersDisplayStatus([out])[0];
    }
    if (
      asCustomerScope ||
      user.type === UserTypeEnum.USER ||
      user.type === UserTypeEnum.ADMIN
    ) {
      return out as unknown as typeof order;
    }
    const vendorRow = OrdersService.stripCustomerContactForVendor(out);
    return this.stripPickupCodeForNonClients([
      vendorRow,
    ])[0] as unknown as typeof order;
  }

  /**
   * Payload Trustpilot Invitation Script (page `/checkout-success`).
   * Sécurisé par l’id de session Stripe (`cs_…` / `pi_…`), non devinable.
   */
  async getTrustpilotInvitationBySessionId(sessionId: string): Promise<{
    recipientEmail: string;
    recipientName: string;
    referenceId: string;
    source: 'InvitationScript';
    productSkus: string[];
    products: Array<{
      sku: string;
      productUrl: string;
      imageUrl?: string;
      name: string;
    }>;
  }> {
    const sid = sessionId?.trim();
    if (!sid || sid.length < 10) {
      throw new NotFoundException('checkout_session_not_found');
    }

    const processed = await this._stripeProcessedCheckoutModel
      .findOne({ sessionId: sid })
      .lean()
      .exec();
    if (!processed?.orderIds?.length) {
      throw new NotFoundException('checkout_session_not_found');
    }

    const orderObjectIds = processed.orderIds
      .map((id) => String(id ?? '').trim())
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (!orderObjectIds.length) {
      throw new NotFoundException('checkout_session_not_found');
    }

    const orders = await this._orderModel
      .find({ _id: { $in: orderObjectIds } })
      .populate({ path: 'store', select: 'name' })
      .populate({ path: 'user', select: 'fullName email' })
      .lean()
      .exec();
    if (!orders.length) {
      throw new NotFoundException('checkout_session_not_found');
    }

    const userRaw = orders[0]?.user as
      | { email?: string; fullName?: string }
      | null
      | undefined;
    const recipientEmail = userRaw?.email?.trim() ?? '';
    if (!recipientEmail || !recipientEmail.includes('@')) {
      throw new NotFoundException('checkout_session_not_found');
    }
    const recipientName =
      userRaw?.fullName?.trim() || recipientEmail.split('@')[0] || 'Client';

    const publicWeb = (
      this._config.get<string>('PUBLIC_WEB_URL')?.trim() ||
      this._config.get<string>('EMAIL_WEBSITE_URL')?.trim() ||
      'https://wise-eat.com'
    ).replace(/\/+$/, '');

    const products: Array<{
      sku: string;
      productUrl: string;
      imageUrl?: string;
      name: string;
    }> = [];
    const productSkus: string[] = [];
    const seen = new Set<string>();

    for (const order of orders) {
      const storeRaw = order.store as unknown as
        | { _id?: Types.ObjectId; name?: string }
        | null
        | undefined;
      const storeId = storeRaw?._id ? String(storeRaw._id) : '';
      const storeName = storeRaw?.name?.trim() || 'Restaurant';
      const storeSeg = storeId
        ? `${storeId}-${this.slugifyForPublicPath(storeName)}`
        : '';

      for (const item of order.items ?? []) {
        const row = item as OrdeLineItem & {
          pictureUrl?: string;
          picture_url?: string;
        };
        const name = String(row.label ?? '').trim() || 'Article';
        const entityId = String(row.entityId ?? '').trim();
        const sku =
          entityId ||
          `${String(order._id)}-${productSkus.length + 1}`;
        if (seen.has(sku)) continue;
        seen.add(sku);
        productSkus.push(sku);

        const itemType = String(row.itemType ?? '').toLowerCase();
        let path = `/orders/${encodeURIComponent(String(order._id))}`;
        if (storeSeg && entityId) {
          if (itemType === CartItemTypeEnum.DRINK) {
            path = `/stores/${storeSeg}/drinks/${encodeURIComponent(entityId)}`;
          } else {
            const productSeg = `${entityId}-${this.slugifyForPublicPath(name)}`;
            path = `/stores/${storeSeg}/products/${productSeg}`;
          }
        }
        const imageUrl =
          String(row.pictureUrl ?? row.picture_url ?? '').trim() || undefined;
        products.push({
          sku,
          productUrl: `${publicWeb}${path}`,
          ...(imageUrl ? { imageUrl } : {}),
          name,
        });
      }
    }

    const primaryOrderId = String(orders[0]?._id ?? '');
    const referenceId =
      orders.length === 1 && primaryOrderId
        ? orderInvoiceRef(primaryOrderId)
        : sid;

    return {
      recipientEmail,
      recipientName,
      referenceId,
      source: 'InvitationScript',
      productSkus,
      products,
    };
  }

  private slugifyForPublicPath(value: string): string {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'item';
  }

  /** Résumé public pour la landing web `/orders/:id` (liens e-mail de reçu). */
  async getPublicOrderSummary(orderId: string) {
    const oid = orderId?.trim();
    if (!oid || !Types.ObjectId.isValid(oid)) {
      throw new NotFoundException('order_not_found');
    }

    const order = await this._orderModel
      .findById(new Types.ObjectId(oid))
      .populate({ path: 'store', select: 'name profileImage' })
      .lean()
      .exec();

    if (!order) {
      throw new NotFoundException('order_not_found');
    }

    const status = String(order.status ?? '').toLowerCase();
    if (status === OrderStatusEnum.CREATED) {
      throw new NotFoundException('order_not_found');
    }

    const storeRaw = order.store as unknown as
      | { _id?: Types.ObjectId; name?: string; profileImage?: string }
      | null
      | undefined;
    const storeId = storeRaw?._id ? String(storeRaw._id) : undefined;
    const storeName = storeRaw?.name?.trim() || 'Restaurant';

    const snap = order.deliveryAddressSnapshot as
      | Record<string, unknown>
      | undefined;
    let deliveryLine = 'Retrait sur place';
    if (order.shouldShip) {
      const city = String(snap?.city ?? '').trim();
      deliveryLine = city ? `Livraison — ${city}` : 'Livraison';
    }

    const items = (order.items ?? []).map((it) => {
      const row = it as OrdeLineItem & {
        pictureUrl?: string;
        picture_url?: string;
      };
      return {
        label: String(row.label ?? '').trim() || 'Article',
        quantity: Math.max(0, Number(row.quantity) || 0),
        price: Math.max(0, Number(row.price) || 0),
        pictureUrl:
          String(row.pictureUrl ?? row.picture_url ?? '').trim() || undefined,
      };
    });

    const pickupCode =
      !order.shouldShip &&
      typeof order.pickupCode === 'string' &&
      order.pickupCode.trim()
        ? order.pickupCode.trim().toUpperCase()
        : undefined;

    return {
      orderId: oid,
      ref: orderInvoiceRef(oid),
      status,
      statusLabel: this.publicOrderStatusLabel(status),
      createdAt: order.createdAt,
      currency:
        typeof order.currency === 'string'
          ? order.currency.trim().toUpperCase()
          : 'CAD',
      totalPrice: Number(order.totalPrice) || 0,
      subtotalBeforeTax: Number(order.subtotalBeforeTax) || undefined,
      shippingPrice: Number(order.shippingPrice) || 0,
      deliveryTipCents: Math.max(
        0,
        Math.round(Number(order.deliveryTipCents) || 0),
      ),
      taxTotal: Number(order.taxTotal) || undefined,
      shouldShip: Boolean(order.shouldShip),
      deliveryLine,
      pickupCode,
      store: {
        id: storeId,
        name: storeName,
        profileImage: storeRaw?.profileImage?.trim() || undefined,
      },
      items,
    };
  }

  private publicOrderStatusLabel(status: string): string {
    switch (String(status ?? '').toLowerCase()) {
      case OrderStatusEnum.PAIED:
        return 'Payée';
      case OrderStatusEnum.APPROVED:
        return 'Confirmée';
      case OrderStatusEnum.SHIPPED:
        return 'En livraison';
      case OrderStatusEnum.COMPLETED:
        return 'Terminée';
      case OrderStatusEnum.CANCELLED:
        return 'Annulée';
      default:
        return 'Commande';
    }
  }

  async createFromCart(
    storeId: string,
    user: UserModel,
    options?: {
      isPreOrder?: boolean;
      scheduledAt?: Date;
      customerNote?: string;
      /** Destinataire cadeau — panier reste celui du payeur JWT. */
      giftRecipientUserId?: string;
    },
  ) {
    const cart = await this._cartService.findOneByStoreId(storeId, user);

    if (!cart?.items?.length) {
      throw new NotFoundException('cart_is_empty');
    }

    // 1. Résoudre destinataire cadeau (sinon client = payeur).
    const giftParties = await this.resolveGiftPartiesForCheckout(
      user,
      options?.giftRecipientUserId,
    );
    const orderCustomerId = giftParties.orderUserId;
    const paidByUserId = giftParties.paidByUserId;
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
          selected_complements?: unknown;
          selectedSupplements?: unknown;
          selected_supplements?: unknown;
          selectedVariantLabel?: string;
          selected_variant_label?: string;
          commissionRetrieveStrategy?: string;
          bundleId?: unknown;
          bundleGroupId?: string;
          bundleTitle?: string;
        };
        // Fix: toJSON / lean peuvent exposer snake_case — ne plus perdre les options panier.
        const complements = normalizeSelectedComplements(
          row.selectedComplements ?? row.selected_complements,
        );
        const supplements = normalizeSelectedSupplements(
          row.selectedSupplements ?? row.selected_supplements,
        );
        const variantLabel = normalizeSelectedVariantLabel(
          row.selectedVariantLabel ?? row.selected_variant_label,
        );
        const strategyRaw = String(row.commissionRetrieveStrategy ?? '').trim();
        const commissionRetrieveStrategy =
          strategyRaw === 'add_to_price' || strategyRaw === 'on_payout'
            ? strategyRaw
            : undefined;
        // Combo : propager le groupe pour regroupement facture / détail.
        const bundleGroupId = String(row.bundleGroupId ?? '').trim();
        const bundleTitle = String(row.bundleTitle ?? '').trim();
        const bundleIdRaw = row.bundleId;
        const bundleIdStr =
          bundleIdRaw != null ? String(bundleIdRaw).trim() : '';
        return {
          label,
          itemType: item.type!,
          entityId: String(item.entityId ?? ''),
          pictureUrl: e?.profileImage,
          quantity: item.quantity!,
          price: item.price!,
          categoryTitle: await this.categoryTitleForCartLine(item),
          selectedComplements: complements,
          selectedSupplements: supplements,
          ...(variantLabel ? { selectedVariantLabel: variantLabel } : {}),
          ...(commissionRetrieveStrategy
            ? { commissionRetrieveStrategy }
            : {}),
          ...(bundleGroupId ? { bundleGroupId } : {}),
          ...(bundleTitle ? { bundleTitle } : {}),
          ...(bundleIdStr && Types.ObjectId.isValid(bundleIdStr)
            ? { bundleId: new Types.ObjectId(bundleIdStr) }
            : {}),
        };
      },
    );

    const calculatedPrice = items.reduce(
      (acc, item) => acc + item.price * item.quantity,
      0,
    );

    const storeLean = await this._storeModel
      .findById(storeId)
      .populate('address', 'countryCode')
      .select('region phoneNumber currency address')
      .lean()
      .exec();
    const storeRegionCode =
      resolveStoreTaxCountryCode(storeLean) || undefined;

    const order = await this._orderModel.create({
      status: OrderStatusEnum.CREATED,
      store: new Types.ObjectId(String(storeId)),
      // Cadeau : destinataire = client ; sinon payeur JWT.
      user: new Types.ObjectId(orderCustomerId),
      ...(paidByUserId
        ? { paidBy: new Types.ObjectId(paidByUserId) }
        : {}),
      items,
      totalPrice: calculatedPrice, // TODO should we add shipping price here?
      shippingPrice: 0,
      isPreOrder: options?.isPreOrder === true,
      scheduledAt: options?.scheduledAt,
      customerNote: options?.customerNote?.trim() || undefined,
      ...(storeRegionCode ? { storeRegionCode } : {}),
    });

    const orderIdStr = order._id.toString();
    await this.recordOrderStatusChangeIfLegacy({
      orderId: orderIdStr,
      storeId: String(storeId),
      customerUserId: orderCustomerId,
      toStatus: OrderStatusEnum.CREATED,
      source: OrderStatusChangeSourceEnum.CHECKOUT,
      // Acteur = payeur (offreur ou client classique).
      actorUserId: String(user.id),
    });

    // Ne pas passer par findOneById (ACL vendeur) : un compte VENDOR qui commande
    // chez une autre boutique échouait avec order_not_found après création.
    const created = await this._orderModel
      .findById(order._id)
      .populate({
        path: 'store',
        populate: [{ path: 'address' }],
      })
      .populate(OrdersService.orderUserWithAddressesPopulate)
      .populate(OrdersService.orderPaidByPopulate)
      .exec();
    if (!created) {
      throw new NotFoundException('order_not_found');
    }
    this.emitOrderCreatedFromDoc(created);
    // WS : destinataire + offreur (si cadeau).
    this.notifyOrderPartiesRealtime(
      created,
      OrderStatusEnum.CREATED,
      undefined,
      paidByUserId && paidByUserId !== orderCustomerId
        ? { additionalPartyUserIds: [paidByUserId] }
        : undefined,
    );
    const storePop = created.store as { name?: string } | null | undefined;
    // Push / inbox destinataire (commande offerte ou classique).
    await this._notificationsService.pushCustomerOrderCreated({
      userId: orderCustomerId,
      orderId: orderIdStr,
      storeName: storePop?.name?.trim() || undefined,
      storeId: String(storeId),
      ...(giftParties.isGift ? { isGiftOrder: true as const } : {}),
    });

    const sname = storePop?.name?.trim() || 'Boutique';
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
      // Client de la commande = destinataire si cadeau.
      customerUserId: orderCustomerId,
      inboxMessage: buildVendorOrderCreatedInboxMessage(msgArgs),
      push: {
        title: 'Nouvelle commande',
        body: buildVendorOrderCreatedPushBody(msgArgs),
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

  /**
   * Valide `giftRecipientUserId` (existence Mongo) et résout user / paidBy.
   * Panier toujours chargé via le payeur JWT.
   */
  private async resolveGiftPartiesForCheckout(
    payer: UserModel,
    giftRecipientUserId?: string | null,
  ): Promise<ReturnType<typeof resolveGiftOrderParties>> {
    const raw = String(giftRecipientUserId ?? '').trim();
    if (!raw) {
      return resolveGiftOrderParties({ payerUserId: String(payer.id) });
    }
    if (!Types.ObjectId.isValid(raw)) {
      throw new BadRequestException('gift_recipient_invalid');
    }
    let parties: ReturnType<typeof resolveGiftOrderParties>;
    try {
      parties = resolveGiftOrderParties({
        payerUserId: String(payer.id),
        giftRecipientUserId: raw,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'cannot_gift_self') {
        throw new BadRequestException('cannot_gift_self');
      }
      throw e;
    }
    const exists = await this._userModel
      .exists({ _id: new Types.ObjectId(parties.orderUserId) })
      .exec();
    if (!exists) {
      throw new NotFoundException('user_not_found');
    }
    return parties;
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
        createdAt: { $gte: new Date(Date.now() - 15 * 60 * 1000) },
      })
      .sort({ createdAt: -1 })
      .select('_id')
      .lean()
      .exec();
    if (pending?._id) {
      return pending._id.toString();
    }

    const preOrder = await this._orderModel
      .findOne({
        user: uid,
        store: sid,
        status: OrderStatusEnum.CREATED,
        isPreOrder: true,
      })
      .sort({ createdAt: -1 })
      .select('_id')
      .lean()
      .exec();
    if (preOrder?._id) {
      return preOrder._id.toString();
    }
    return null;
  }

  /** Pré-commande impayée : cible valide pour un PaymentIntent existant. */
  async assertPreOrderPayableByClient(
    orderId: string,
    userId: string,
    storeId: string,
  ): Promise<boolean> {
    if (
      !Types.ObjectId.isValid(orderId) ||
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(storeId)
    ) {
      return false;
    }
    const row = await this._orderModel
      .findOne({
        _id: new Types.ObjectId(orderId),
        user: new Types.ObjectId(userId),
        store: new Types.ObjectId(storeId),
        isPreOrder: true,
        status: OrderStatusEnum.CREATED,
        stripeParentPaymentId: { $exists: false },
      })
      .select('_id')
      .lean()
      .exec();
    return Boolean(row?._id);
  }

  /**
   * Lignes panier synthétiques pour checkout groupé d’une pré-commande impayée
   * (le panier serveur a été vidé à la création de la commande).
   */
  async buildCartGroupFromPayablePreOrder(
    orderId: string,
    userId: string,
    storeId: string,
  ): Promise<{
    store: Record<string, unknown>;
    items: Record<string, unknown>[];
    totalPrice: number;
  }> {
    const oid = orderId.trim();
    const sid = storeId.trim();
    const uid = userId.trim();
    const ok = await this.assertPreOrderPayableByClient(oid, uid, sid);
    if (!ok) {
      throw new BadRequestException('pre_order_not_payable');
    }
    const order = await this._orderModel
      .findOne({
        _id: new Types.ObjectId(oid),
        user: new Types.ObjectId(uid),
        store: new Types.ObjectId(sid),
        isPreOrder: true,
        status: OrderStatusEnum.CREATED,
        stripeParentPaymentId: { $exists: false },
      })
      .populate({
        path: 'store',
        select:
          'name currency supportsShipping acceptsOrders acceptsPickupPayOnDelivery defaultPickupPayOnPickup bio region timezone address shippingZones',
        populate: {
          path: 'address',
          select: 'address city country countryCode zipCode label location',
        },
      })
      .lean()
      .exec();
    if (!order) {
      throw new NotFoundException('order_not_found');
    }
    const rawItems = (order.items ?? []) as OrdeLineItem[];
    const items = rawItems
      .filter((it) => {
        const t = String(it.itemType ?? '')
          .trim()
          .toLowerCase();
        return t !== 'offer';
      })
      .map((it, idx) => {
        const itemType = String(it.itemType ?? 'product');
        return {
          _id: `pre-${oid}-${idx}`,
          type: itemType,
          entityId: String(it.entityId ?? ''),
          quantity: Math.max(1, Number(it.quantity ?? 1)),
          price: Number(it.price ?? 0),
          entity: {
            title: String(it.label ?? 'Article'),
            name: String(it.label ?? 'Article'),
            profileImage: it.pictureUrl,
          },
          // Pré-commande → panier : mêmes options que createFromCart (camel + snake).
          selectedComplements: normalizeSelectedComplements(
            (it as { selectedComplements?: unknown; selected_complements?: unknown })
              .selectedComplements ??
              (it as { selected_complements?: unknown }).selected_complements,
          ),
          selectedSupplements: normalizeSelectedSupplements(
            (it as { selectedSupplements?: unknown; selected_supplements?: unknown })
              .selectedSupplements ??
              (it as { selected_supplements?: unknown }).selected_supplements,
          ),
          ...(() => {
            const v = normalizeSelectedVariantLabel(
              (it as { selectedVariantLabel?: string; selected_variant_label?: string })
                .selectedVariantLabel ??
                (it as { selected_variant_label?: string }).selected_variant_label,
            );
            return v ? { selectedVariantLabel: v } : {};
          })(),
        };
      });
    if (!items.length) {
      throw new BadRequestException('pre_order_items_empty');
    }
    const summed = items.reduce(
      (acc, line) =>
        acc + Number(line.price ?? 0) * Number(line.quantity ?? 1),
      0,
    );
    const totalPrice =
      Number.isFinite(Number(order.totalPrice)) && Number(order.totalPrice) > 0
        ? Number(order.totalPrice)
        : summed;
    const store = order.store as Record<string, unknown>;
    return { store, items, totalPrice };
  }

  /** Charge une pré-commande client avant création PaymentIntent. */
  async getPreOrderForClientPayment(
    orderId: string,
    user: UserModel,
  ): Promise<{
    orderId: string;
    storeId: string;
    storeName: string;
    totalPrice: number;
    currency: string;
  }> {
    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) {
      throw new NotFoundException('order_not_found');
    }
    const order = await this._orderModel
      .findOne({
        _id: new Types.ObjectId(oid),
        user: new Types.ObjectId(String(user.id)),
        isPreOrder: true,
        status: OrderStatusEnum.CREATED,
      })
      .populate('store', 'name currency')
      .lean()
      .exec();
    if (!order) {
      throw new NotFoundException('order_not_found');
    }
    const storeRaw = order.store as unknown;
    const store =
      storeRaw && typeof storeRaw === 'object'
        ? (storeRaw as Record<string, unknown>)
        : null;
    const storeId = String(store?._id ?? store?.id ?? '').trim();
    if (!storeId) {
      throw new BadRequestException('order_store_missing');
    }
    const totalPrice = Number(order.totalPrice ?? 0);
    if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
      throw new BadRequestException('pre_order_invalid_amount');
    }
    return {
      orderId: oid,
      storeId,
      storeName: String(store?.name ?? 'Wise Eat').trim() || 'Wise Eat',
      totalPrice,
      currency: String(order.currency ?? store?.currency ?? 'CAD')
        .trim()
        .toUpperCase(),
    };
  }

  /** Ajoute une entrée `stores.vendor_messages` + refresh inbox WebSocket. */
  private async appendStoreVendorOrderMessage(
    storeId: string,
    message: string,
    notifyUserIds: string[],
    from: 'SYSTEM' | 'ADMIN' | 'CLIENT' = 'SYSTEM',
  ): Promise<void> {
    const text = message.trim();
    if (!text || !Types.ObjectId.isValid(storeId)) return;
    await this._storeModel.updateOne(
      { _id: new Types.ObjectId(storeId) },
      {
        $push: {
          vendorMessages: {
            message: text,
            from,
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
   * Notifie la boutique selon les préférences canal (Commandes → push / e-mail / SMS).
   * Inbox admin + FCM push partagent le toggle « Push » ; le client commandeur est exclu du push.
   */
  private async notifyStoreVendorsForOrder(args: {
    storeId: string;
    customerUserId?: string | null;
    inboxMessage: string;
    /** Origine inbox (ADMIN pour notes plateforme). */
    inboxFrom?: 'SYSTEM' | 'ADMIN' | 'CLIENT';
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
          args.inboxFrom ?? 'SYSTEM',
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
        : ctx.reason === 'pre_order_d_day'
          ? buildVendorPreOrderDDayInboxMessage(msgArgs)
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
            : ctx.reason === 'pre_order_d_day'
              ? buildVendorPreOrderDDayPushBody(msgArgs)
            : ctx.reason === 'new_order'
              ? buildVendorOrderCreatedPushBody(msgArgs)
              : push.body,
        orderId: orderIdStr,
        storeName,
        reason: push.reason,
        status: ctx.status,
      },
      email:
        ctx.reason === 'order_cancelled'
          ? undefined
          : {
              event: (ctx.reason === 'pre_order_d_day'
                ? 'pre_order_d_day'
                : ctx.reason) as VendorOrderEmailEvent,
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

  /** Rappel vendeur / équipe (push + e-mail + inbox) pour une pré-commande planifiée. */
  notifyStoreVendorsForPreOrderVendorReminder(
    order: OrderModel,
    ctx: {
      reminderKey: 'd-3' | 'd-2' | 'd-1' | 'd-day';
      daysUntil: number;
      scheduledAtLabel: string;
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
    const itemCount = items.reduce(
      (s, i) => s + Math.max(1, Math.round(Number(i.quantity) || 1)),
      0,
    );
    const title =
      ctx.reminderKey === 'd-day'
        ? 'Rappel pré-commande — aujourd\'hui'
        : `Rappel pré-commande — J-${ctx.daysUntil}`;
    const inbox = buildVendorPreOrderReminderInboxMessage({
      orderId: orderIdStr,
      items,
      totalPrice,
      currency,
      daysUntil: ctx.daysUntil,
      scheduledAtLabel: ctx.scheduledAtLabel,
    });
    const pushBody = buildVendorPreOrderReminderPushBody({
      storeName,
      orderId: orderIdStr,
      daysUntil: ctx.daysUntil,
      scheduledAtLabel: ctx.scheduledAtLabel,
    });

    void this.notifyStoreVendorsForOrder({
      storeId,
      customerUserId: this.userIdFromOrderDoc(order),
      inboxMessage: inbox,
      push: {
        title,
        body: pushBody,
        orderId: orderIdStr,
        storeName,
        reason: `pre_order_reminder_${ctx.reminderKey}`,
        status: String(order.status ?? ''),
      },
      email: {
        event: 'pre_order_reminder',
        orderId: orderIdStr,
        storeName,
        totalPrice,
        currency,
        itemCount,
        note: ctx.scheduledAtLabel,
        statusLabel:
          ctx.daysUntil === 0
            ? 'Pré-commande aujourd\'hui'
            : `Pré-commande dans ${ctx.daysUntil} jour(s)`,
      },
      logTag: `pre_order_vendor_reminder_${ctx.reminderKey}`,
    });
  }

  /** Marque une pré-commande comme active (jour J) et alerte la boutique si commande payable. */
  async promotePreOrderOnDDay(orderId: string): Promise<void> {
    const order = await this._orderModel
      .findById(orderId)
      .populate({
        path: 'store',
        select: 'name profileImage status currency acceptsOrders supportsShipping bio',
      })
      .exec();
    if (!order?.isPreOrder || !order.scheduledAt) return;

    if (!order.preOrderPromotedAt) {
      order.preOrderPromotedAt = new Date();
      await order.save();
    }

    const st = String(order.status ?? '').trim().toLowerCase();
    if (
      st === OrderStatusEnum.CANCELLED ||
      st === OrderStatusEnum.COMPLETED
    ) {
      return;
    }

    if (
      isOrderStatusPaidForVendorWorkflow(st) &&
      !order.vendorAcceptedAt
    ) {
      this.notifyStoreVendorsForOrderStatusChange(order, {
        reason: 'pre_order_d_day',
        status: st as OrderStatusEnum,
      });
    }
  }

  /**
   * Annulation : push + e-mail client ; e-mail propriétaire boutique (pas équipe / admins).
   */
  private notifyOrderCancelledParties(
    order: OrderModel,
    args: {
      previousStatus: string;
      bodyOverride: string;
      note?: string;
    },
  ): void {
    const customerId = this.userIdFromOrderDoc(order);
    const oid = order._id.toString();
    const storeId = this.storeIdFromOrderDoc(order);
    const storeName = this.storeNameFromPopulated(order.store);
    const items = (order.items ?? []) as OrdeLineItem[];
    const itemCount = items.reduce(
      (s, i) => s + Math.max(1, Math.round(Number(i.quantity) || 1)),
      0,
    );
    const totalPrice = Number(order.totalPrice) || 0;
    const currency =
      typeof order.currency === 'string' ? order.currency : undefined;

    if (customerId) {
      void this._notificationsService
        .pushCustomerOrderStatusChanged({
          userId: customerId,
          orderId: oid,
          storeName,
          storeId: storeId ?? undefined,
          previousStatus: args.previousStatus,
          newStatus: OrderStatusEnum.CANCELLED,
          bodyOverride: args.bodyOverride,
        })
        .catch((err) =>
          this.logger.warn(
            `FCM order cancel: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );

      void this._vendorStatusEmail
        .sendCustomerOrderCancelledEmail({
          customerUserId: customerId,
          orderId: oid,
          storeName,
          body: args.bodyOverride,
          note: args.note,
        })
        .catch((err) =>
          this.logger.warn(
            `Email order cancel customer: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
    }

    if (storeId) {
      void this._vendorStatusEmail
        .sendStoreOwnerOrderCancelledEmail({
          storeId,
          orderId: oid,
          storeName,
          totalPrice,
          currency,
          itemCount,
          note: args.note,
          excludeUserId: customerId ?? undefined,
        })
        .catch((err) =>
          this.logger.warn(
            `Email order cancel owner: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
    }
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
      couponDiscountAmount?: number;
      giftCode?: string;
      giftCodeDiscountAmount?: number;
      chargedGoodsCents?: number;
      chargedShipCents?: number;
      chargedTaxCents?: number;
      taxTotal?: number;
      taxLines?: RegionTaxLineResult[];
      taxCountryCode?: string;
      subtotalBeforeTax?: number;
      deliveryAddressId?: string;
      currency?: string;
      deliveryTipCents?: number;
      deliveryTipAllocationMethod?: string;
      orderPaymentFeeCents?: number;
      payOnPickup?: boolean;
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
    const isPayOnPickup = opts?.payOnPickup === true;
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
    let storeRegionCode = String(
      (o as { storeRegionCode?: string }).storeRegionCode ?? '',
    )
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
      const storePop = await this._storeModel
        .findById(o.store)
        .populate('address', 'countryCode')
        .select('region phoneNumber currency address')
        .lean()
        .exec();
      const storeCc = resolveStoreTaxCountryCode(storePop);
      if (/^[A-Z]{2}$/.test(storeCc)) {
        storeRegionCode = storeCc;
      }
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
      const cc =
        resolveTaxCountryCode([
          storeCc,
          deliveryCc,
          (customer as UserModel & { appCountryCode?: string })
            ?.appCountryCode,
        ]) || 'CA';
      const breakdown = await this._supportedCountries.computeTaxesForModule({
        countryCode: cc,
        baseAmount: subtotalBeforeTax,
        module: 'order',
      });
      taxTotal = breakdown.taxTotal;
      taxLines = breakdown.lines;
      taxCountryCode = breakdown.countryCode;
    }

    if (!/^[A-Z]{2}$/.test(storeRegionCode)) {
      const storeForRegion = await this._storeModel
        .findById(o.store)
        .populate('address', 'countryCode')
        .select('region phoneNumber currency address')
        .lean()
        .exec();
      storeRegionCode = resolveStoreTaxCountryCode(storeForRegion) || '';
    }

    const currencyCode = (
      opts?.currency ??
      (o as { currency?: string }).currency ??
      'CAD'
    )
      .trim()
      .toUpperCase() || 'CAD';

    let totalPrice: number;
    let shippingStored: number;
    if (gC != null && sC != null) {
      const taxPart = tC ?? toStripeMinorUnits(taxTotal, currencyCode);
      const totalMinor = Math.round(gC + sC + taxPart + Number.EPSILON);
      totalPrice = fromStripeMinorUnits(totalMinor, currencyCode);
      shippingStored = fromStripeMinorUnits(sC, currencyCode);
    } else {
      shippingStored = ship;
      totalPrice =
        Math.round((subtotalBeforeTax + taxTotal) * 100 + Number.EPSILON) /
        100;
    }

    const isPickup = shippingStored <= 0;
    const paidStatus = isPayOnPickup
      ? OrderStatusEnum.AWAITING_CASH
      : OrderStatusEnum.PAIED;
    const $set: Record<string, unknown> = {
      status: paidStatus,
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
      ...(storeRegionCode ? { storeRegionCode } : {}),
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
    if (opts?.payOnPickup === true) {
      $set['payOnPickup'] = true;
    }
    if (opts?.couponCode?.trim()) {
      $set['couponCode'] = opts.couponCode.trim().toUpperCase();
    }
    if (opts?.couponDiscountAmount != null) {
      $set['couponDiscountAmount'] = Math.max(
        0,
        Number(opts.couponDiscountAmount) || 0,
      );
    }
    if (opts?.giftCode?.trim()) {
      $set['giftCode'] = opts.giftCode.trim().toUpperCase();
    }
    if (opts?.giftCodeDiscountAmount != null) {
      $set['giftCodeDiscountAmount'] = Math.max(
        0,
        Number(opts.giftCodeDiscountAmount) || 0,
      );
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

    const tipCents =
      opts?.deliveryTipCents != null && Number.isFinite(opts.deliveryTipCents)
        ? Math.max(0, Math.round(opts.deliveryTipCents))
        : 0;
    const orderPaymentFeeCents =
      isPayOnPickup
        ? 0
        : opts?.orderPaymentFeeCents != null &&
            Number.isFinite(opts.orderPaymentFeeCents)
          ? Math.max(0, Math.round(opts.orderPaymentFeeCents))
          : 0;
    if (!isPickup && tipCents > 0) {
      $set['deliveryTipCents'] = tipCents;
      $set['deliveryTipStatus'] = 'pending';
      if (opts?.deliveryTipAllocationMethod?.trim()) {
        $set['deliveryTipAllocationMethod'] =
          opts.deliveryTipAllocationMethod.trim();
      }
    } else {
      $set['deliveryTipCents'] = 0;
      $set['deliveryTipStatus'] = 'none';
    }

    if (orderPaymentFeeCents > 0) {
      $set['orderPaymentFeeCents'] = orderPaymentFeeCents;
    } else {
      $set['orderPaymentFeeCents'] = 0;
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

    if (prevStatus !== paidStatus) {
      const storeIdForEvent = objectIdStringFromRef(o.store);
      const customerIdForEvent = objectIdStringFromRef(o.user);
      const uid = customerIdForEvent;
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
      const amountCents =
        gC != null && sC != null && tC != null
          ? gC + sC + tC
          : Math.round((subtotalBeforeTax + taxTotal) * 100);
      const currency = opts?.currency?.trim()?.toUpperCase() || 'CAD';
      const statusEventSource = isPayOnPickup
        ? OrderStatusChangeSourceEnum.CHECKOUT
        : OrderStatusChangeSourceEnum.STRIPE;

      if (!isPayOnPickup) {
        /** Reçu client : envoi idempotent (retry webhook / sync mobile). */
        void this._orderPaidInvoiceEmail
          .ensurePaidReceiptEmail(orderId)
          .catch((err) =>
            this.logger.warn(
              `order paid invoice email order=${orderId}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            ),
          );
      }

      const legacyPaidSideEffects = async (): Promise<void> => {
        await this._orderStatusEvents.record({
          orderId,
          storeId: storeIdForEvent,
          customerUserId: customerIdForEvent,
          fromStatus: prevStatus || undefined,
          toStatus: paidStatus,
          source: statusEventSource,
        });
        let storeName: string | undefined;
        const rawStore = o.store as unknown;
        if (rawStore && typeof rawStore === 'object' && 'name' in rawStore) {
          const nm = (rawStore as { name?: unknown }).name;
          if (typeof nm === 'string' && nm.trim()) {
            storeName = nm.trim();
          }
        }
        const storeIdForCustomer = storeIdForEvent;
        // Cadeau : `o.user` = destinataire ; `paidBy` = offreur.
        const paidById = objectIdStringFromRef(
          (o as { paidBy?: unknown }).paidBy,
        );
        const isGiftOrder = Boolean(paidById);
        if (uid && Types.ObjectId.isValid(uid)) {
          void this._notificationsService
            .pushCustomerOrderStatusChanged({
              userId: uid,
              orderId,
              storeName,
              storeId: storeIdForCustomer,
              previousStatus: prevStatus,
              newStatus: paidStatus,
              ...(isGiftOrder
                ? {
                    titleOverride: 'Commande offerte',
                    bodyOverride: isPayOnPickup
                      ? 'Quelqu’un vous a offert une commande — paiement au retrait en boutique'
                      : 'Quelqu’un vous a offert une commande — elle est payée.',
                  }
                : {
                    bodyOverride: isPayOnPickup
                      ? 'Commande enregistrée — paiement à effectuer lors du retrait en boutique'
                      : undefined,
                  }),
            })
            .catch((err) =>
              this.logger.warn(
                `FCM order paid: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              ),
            );
        }
        void this._wsOrderNotifyHandler?.notifyPartiesByOrderId(
          orderId,
          paidStatus,
          undefined,
          paidById && paidById !== uid
            ? { additionalPartyUserIds: [paidById] }
            : undefined,
        );
        if (!isPayOnPickup) {
          const storeIdForAds = storeIdForEvent;
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
        void (isPayOnPickup
          ? this.ensureVendorPayOnPickupOrderNotifications(orderId)
          : this.ensureVendorPaidOrderNotifications(orderId)
        ).catch((err) =>
          this.logger.warn(
            `vendor paid notify order=${orderId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
      };

      if (this._orderDomainBridge && storeIdForEvent && customerIdForEvent) {
        void (async () => {
          const wsDispatch =
            await this.buildOrderDomainDispatchContextByOrderId(
              orderId,
              OrderStatusEnum.PAIED,
            );
          await this._orderDomainBridge!.emitOrLegacy(
            {
              type: 'order.paid',
              payload: {
                orderId,
                storeId: storeIdForEvent,
                customerUserId: customerIdForEvent,
                amountCents,
                currency,
              },
              metadata: {
                source: 'orders',
                orderContext: {
                  fromStatus: prevStatus,
                  paidItemRefs,
                  payOnPickup: isPayOnPickup,
                  storeId: storeIdForEvent,
                  customerUserId: customerIdForEvent,
                  ...(wsDispatch ?? {}),
                },
              },
            },
            legacyPaidSideEffects,
          );
          void this._wsOrderNotifyHandler?.notifyPartiesByOrderId(
            orderId,
            OrderStatusEnum.PAIED,
          );
        })();
      } else {
        void legacyPaidSideEffects();
      }
    } else {
      if (!isPayOnPickup) {
        void this._orderPaidInvoiceEmail
          .ensurePaidReceiptEmail(orderId)
          .catch((err) =>
            this.logger.warn(
              `order paid invoice email retry order=${orderId}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            ),
          );
      }
      void (isPayOnPickup
        ? this.ensureVendorPayOnPickupOrderNotifications(orderId)
        : this.ensureVendorPaidOrderNotifications(orderId)
      ).catch((err) =>
        this.logger.warn(
          `vendor paid notify order=${orderId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
    }
  }

  /**
   * Reçu/facture client post-paiement (idempotent — safe sur retry webhook/sync).
   */
  ensurePaidReceiptEmail(orderId: string): void {
    void this._orderPaidInvoiceEmail
      .ensurePaidReceiptEmail(orderId)
      .catch((err) =>
        this.logger.warn(
          `order paid invoice email order=${orderId}: ${
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
        payOnPickup: { $ne: true },
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

  /**
   * Message inbox + push vendeur — commande retrait avec paiement cash à la collecte.
   * Idempotent (`vendorPaidNotifiedAt`).
   */
  async ensureVendorPayOnPickupOrderNotifications(
    orderId: string,
  ): Promise<void> {
    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) return;

    const order = await this._orderModel
      .findOne({
        _id: new Types.ObjectId(oid),
        status: OrderStatusEnum.AWAITING_CASH,
        payOnPickup: true,
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
        `ensureVendorPayOnPickupOrderNotifications: storeId missing order=${oid}`,
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

    const msgArgs = {
      orderId: oid,
      items: (order.items ?? []) as OrdeLineItem[],
      totalPrice: Number(order.totalPrice) || 0,
      currency:
        typeof order.currency === 'string' ? order.currency : undefined,
      pickupCode:
        typeof order.pickupCode === 'string' ? order.pickupCode : undefined,
      storeName,
    };

    const itemCount = (order.items ?? []).reduce(
      (s, i) => s + Math.max(1, Math.round(Number(i.quantity) || 1)),
      0,
    );
    await this.notifyStoreVendorsForOrder({
      storeId,
      customerUserId: objectIdStringFromRef(order.user),
      inboxMessage: buildVendorOrderPayOnPickupInboxMessage(msgArgs),
      push: {
        title: 'Commande à payer à la collecte',
        body: buildVendorOrderPayOnPickupPushBody(msgArgs),
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
        itemCount,
        statusLabel: vendorOrderStatusLabelFr(
          OrderStatusEnum.PAIED,
          true,
          true,
        ),
      },
      logTag: 'order_pay_on_pickup',
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
   * Vendeur / admin : prise en charge — le restaurant accepte et prépare (`paied` + `vendorAcceptedAt`).
   * Notifie le client ; distinct de `markOrderReady` (prête livraison / retrait → `approved`).
   */
  async acceptOrder(
    orderId: string,
    user: UserModel,
  ): Promise<{
    orderId: string;
    status: OrderStatusEnum;
    vendorAcceptedAt: string;
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
    if (!isOrderStatusPaidForVendorWorkflow(st)) {
      throw new BadRequestException('order_accept_invalid_status');
    }
    if (order.vendorAcceptedAt) {
      throw new BadRequestException('order_already_accepted');
    }

    const acceptedAt = new Date();
    order.vendorAcceptedAt = acceptedAt;
    await order.save();

    const storeId = this.storeIdFromOrderDoc(order);
    const customerId = this.userIdFromOrderDoc(order);
    const storeName = this.storeNameFromPopulated(order.store);

    if (customerId) {
      void this._notificationsService
        .pushCustomerOrderStatusChanged({
          userId: customerId,
          orderId: oid,
          storeName,
          storeId: storeId ?? undefined,
          previousStatus: st,
          newStatus: OrderStatusEnum.PAIED,
          reason: 'vendor_accepted',
          titleOverride: 'Commande acceptée',
          bodyOverride: 'Votre commande est en préparation.',
        })
        .catch((err) =>
          this.logger.warn(
            `FCM order accept: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
    }

    this.notifyOrderPartiesRealtime(order, OrderStatusEnum.PAIED);
    this.notifyStoreVendorsForOrderStatusChange(order, {
      reason: 'order_accepted',
      status: OrderStatusEnum.PAIED,
      note: 'Prise en charge — en préparation',
    });

    return {
      orderId: oid,
      status: OrderStatusEnum.PAIED,
      vendorAcceptedAt: acceptedAt.toISOString(),
    };
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
    if (!isOrderStatusPaidForVendorWorkflow(st)) {
      throw new BadRequestException('order_ready_invalid_status');
    }

    const isPickup = this.isPickupOrder(order);
    const prevStatus = st;
    order.status = OrderStatusEnum.APPROVED;
    await order.save();

    const storeId = this.storeIdFromOrderDoc(order);
    const customerId = this.userIdFromOrderDoc(order);
    await this.recordOrderStatusChangeIfLegacy({
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
    if (this._orderDomainBridge?.enabled()) {
      void this._orderDomainBridge.emit({
        type: 'order.approved',
        payload: { orderId: oid, actorUserId: String(user.id) },
        metadata: {
          actorUserId: String(user.id),
          orderContext: {
            fromStatus: prevStatus,
            source: OrderStatusChangeSourceEnum.VENDOR,
            ...this.buildOrderDomainDispatchContext(
              order,
              OrderStatusEnum.APPROVED,
            ),
          },
        },
      });
    }
    this.notifyOrderPartiesRealtime(order, OrderStatusEnum.APPROVED);
    this.notifyStoreVendorsForOrderStatusChange(order, {
      reason: 'order_ready',
      status: OrderStatusEnum.APPROVED,
      isPickup,
      note: isPickup ? 'Prête pour retrait' : 'Prête pour livraison',
    });

    void this._stripeDeferredCapture
      .captureOnOrderReady(oid)
      .catch((err) =>
        this.logger.warn(
          `Stripe deferred capture order=${oid}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );

    if (!isPickup && this._deliveryOrderOffers) {
      void this._deliveryOrderOffers
        .startCascadeAfterMarkReady(order)
        .catch((err) =>
          this.logger.warn(
            `auto-offer cascade order=${oid}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        )
        .finally(() => {
          // File ouverte : fan-out géo si pas d’offre exclusive active.
          if (this._marketplaceDispatch) {
            void this._marketplaceDispatch
              .notifyClaimableOrder(order)
              .catch((err) =>
                this.logger.warn(
                  `marketplace notify order=${oid}: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                ),
              );
          }
        });
    } else if (!isPickup && this._marketplaceDispatch) {
      void this._marketplaceDispatch
        .notifyClaimableOrder(order)
        .catch((err) =>
          this.logger.warn(
            `marketplace notify order=${oid}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
    }

    return { orderId: oid, status: OrderStatusEnum.APPROVED, isPickup };
  }

  /**
   * Vendeur : s’assigne la livraison (passe la commande en `shipped` + livreur assigné).
   * Stripe Connect (vendeur ou owner boutique) requis — même contrainte que le livreur
   * pour pouvoir verser frais de livraison + tip sur le compte Connect.
   */
  async assignVendorSelfDelivery(
    orderId: string,
    user: UserModel,
  ): Promise<{ ok: true; orderId: string; orderRef: string; status: OrderStatusEnum }> {
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_only');
    }
    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) {
      throw new NotFoundException('order_not_found');
    }
    const vendorId = new Types.ObjectId(String(user._id ?? user.id));

    const activeOrder = await this._orderModel
      .findOne({
        assignedDeliveryUser: vendorId,
        shouldShip: true,
        status: OrderStatusEnum.SHIPPED,
      })
      .select('_id')
      .lean()
      .exec();
    if (activeOrder && String(activeOrder._id) !== oid) {
      throw new BadRequestException('vendor_active_delivery');
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
    await this.assertVendorSelfDeliveryConnectReady(user, order);

    if (!order.shouldShip) {
      throw new BadRequestException('order_not_shippable');
    }

    const existingAssignee = this.assignedDeliveryUserIdFromOrderDoc(order);
    const st = order.status as OrderStatusEnum;
    const vendorIdStr = String(vendorId);
    const isTakeover =
      st === OrderStatusEnum.SHIPPED &&
      !!existingAssignee &&
      existingAssignee !== vendorIdStr;
    const isOrphanShipped =
      st === OrderStatusEnum.SHIPPED && !existingAssignee;

    if (existingAssignee && existingAssignee !== vendorIdStr && !isTakeover) {
      throw new BadRequestException('order_assigned_to_other');
    }

    const allowedStatuses: OrderStatusEnum[] = [
      OrderStatusEnum.CREATED,
      OrderStatusEnum.PAIED,
      OrderStatusEnum.APPROVED,
    ];
    if (isTakeover || isOrphanShipped) {
      allowedStatuses.push(OrderStatusEnum.SHIPPED);
    }
    if (!allowedStatuses.includes(st)) {
      throw new BadRequestException('order_not_assignable');
    }

    if (existingAssignee === vendorIdStr && st === OrderStatusEnum.SHIPPED) {
      const tail = oid.slice(-6).toUpperCase();
      return {
        ok: true,
        orderId: oid,
        orderRef: `#AE-${tail}`,
        status: OrderStatusEnum.SHIPPED,
      };
    }

    const prevAssignee = existingAssignee;
    const prevStatus = st;
    order.set('assignedDeliveryUser', vendorId);
    if (st !== OrderStatusEnum.SHIPPED) {
      order.status = OrderStatusEnum.SHIPPED;
    }
    await order.save();
    await this._orderModel
      .updateOne({ _id: order._id }, { $unset: courierClaimStaleStateUnset() })
      .exec();

    const storeId = this.storeIdFromOrderDoc(order);
    const customerId = this.userIdFromOrderDoc(order);
    const tail = oid.slice(-6).toUpperCase();
    const orderRef = `#AE-${tail}`;
    const vendorName = user.fullName?.trim() || 'Restaurant';

    if (isTakeover && prevAssignee) {
      await this.recordOrderStatusChangeIfLegacy({
        orderId: oid,
        storeId,
        customerUserId: customerId,
        fromStatus: OrderStatusEnum.SHIPPED,
        toStatus: OrderStatusEnum.SHIPPED,
        source: OrderStatusChangeSourceEnum.VENDOR,
        actorUserId: vendorIdStr,
        note: `Reprise livraison par ${vendorName}`,
      });
      this.notifyOrderPartiesRealtime(order, OrderStatusEnum.SHIPPED, {
        assignedDeliveryUserId: vendorIdStr,
      });
      void this._deliveryAgentService.publishPresenceWs(
        prevAssignee,
        'order_unassigned',
      );
      void this._notificationsService
        .notifyDeliveryAgentOrderAssignment({
          recipientUserId: prevAssignee,
          orderId: oid,
          orderRef,
          storeName: this.storeNameFromPopulated(order.store),
          storeId: storeId ?? undefined,
          action: 'unassigned',
        })
        .catch((err) => {
          this.logger.warn(
            `notifyDeliveryAgentOrderAssignment unassigned: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
    }

    if (prevStatus !== OrderStatusEnum.SHIPPED) {
      await this.recordOrderStatusChangeIfLegacy({
        orderId: oid,
        storeId,
        customerUserId: customerId,
        fromStatus: prevStatus,
        toStatus: OrderStatusEnum.SHIPPED,
        source: OrderStatusChangeSourceEnum.VENDOR,
        actorUserId: String(vendorId),
        note: `Auto-assignation vendeur (${vendorName})`,
      });
    }

    if (customerId && prevStatus !== OrderStatusEnum.SHIPPED) {
      this.sendShippedInvoiceEmail(oid);
      void this._notificationsService
        .pushCustomerOrderStatusChanged({
          userId: customerId,
          orderId: oid,
          storeName: this.storeNameFromPopulated(order.store),
          storeId: storeId ?? undefined,
          previousStatus: prevStatus,
          newStatus: OrderStatusEnum.SHIPPED,
          bodyOverride: 'En cours de livraison',
        })
        .catch((err) =>
          this.logger.warn(
            `FCM order shipped (vendor self): ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );
    }

    if (!isTakeover && prevStatus !== OrderStatusEnum.SHIPPED) {
      this.emitOrderShippedFromDoc(order, {
        prevStatus,
        assignedDeliveryUserId: String(vendorId),
        actorUserId: String(vendorId),
        source: OrderStatusChangeSourceEnum.VENDOR,
        courier: vendorName,
      });
    }

    if (storeId && prevStatus !== OrderStatusEnum.SHIPPED && !isTakeover) {
      const sname = this.storeNameFromPopulated(order.store);
      this.notifyStoreVendorsForOrderStatusChange(order, {
        reason: 'order_shipped',
        status: OrderStatusEnum.SHIPPED,
        note: `Livraison par ${vendorName}`,
        pushBodyOverride: `${sname ?? 'Boutique'} : livraison prise en charge par ${vendorName}.`,
      });
    }

    return {
      ok: true,
      orderId: oid,
      orderRef,
      status: OrderStatusEnum.SHIPPED,
    };
  }

  /**
   * Connect prêt sur le vendeur assigné **ou** sur le owner boutique
   * (frais livraison + tip versés sur ce compte, comme le livreur).
   */
  private async assertVendorSelfDeliveryConnectReady(
    user: UserModel,
    order: OrderModel,
  ): Promise<void> {
    if (
      isStripeConnectOnboardingCompleteUser(user) &&
      String(user.stripeConnectAccountId ?? '').trim()
    ) {
      return;
    }
    const storeId = this.storeIdFromOrderDoc(order);
    if (storeId && Types.ObjectId.isValid(storeId)) {
      const store = await this._storeModel
        .findById(new Types.ObjectId(storeId))
        .select('owner')
        .lean()
        .exec();
      const ownerId = store?.owner ? String(store.owner) : '';
      if (ownerId && Types.ObjectId.isValid(ownerId)) {
        const owner = await this._userModel
          .findById(new Types.ObjectId(ownerId))
          .select(
            'stripeConnectAccountId stripeConnectChargesEnabled stripeConnectPayoutsEnabled stripeConnectDetailsSubmitted stripeConnectDisabledReason stripeConnectRequirementsDue stripeConnectRequirementsPastDue',
          )
          .lean()
          .exec();
        if (
          isStripeConnectOnboardingCompleteUser(owner) &&
          String(owner?.stripeConnectAccountId ?? '').trim()
        ) {
          return;
        }
      }
    }
    throw new BadRequestException('vendor_stripe_onboarding_incomplete');
  }

  /** Vendeur assigné : met à jour la position GPS pour le suivi client. */
  async reportVendorSelfDeliveryLocation(
    orderId: string,
    user: UserModel,
    latitude: number,
    longitude: number,
  ): Promise<{ ok: true }> {
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_only');
    }
    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) {
      throw new NotFoundException('order_not_found');
    }
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new BadRequestException('invalid_coordinates');
    }

    const vendorId = String(user._id ?? user.id);
    const order = await this._orderModel
      .findById(new Types.ObjectId(oid))
      .select('status shouldShip assignedDeliveryUser store')
      .exec();
    if (!order) {
      throw new NotFoundException('order_not_found');
    }

    await this.assertUserCanManageOrderStore(user, order);

    const assignee = this.assignedDeliveryUserIdFromOrderDoc(order);
    if (!assignee || assignee !== vendorId) {
      throw new ForbiddenException('not_assigned_courier');
    }
    if (!order.shouldShip || order.status !== OrderStatusEnum.SHIPPED) {
      throw new BadRequestException('order_not_in_delivery');
    }

    await this.publishCourierPosition(oid, lat, lng);
    return { ok: true };
  }

  /** Vendeur / admin : renvoie le reçu (e-mail + PDF) au client. */
  async sendClientReceiptEmail(
    orderId: string,
    user: UserModel,
  ): Promise<{ ok: true; sentTo: string }> {
    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) {
      throw new NotFoundException('order_not_found');
    }

    const order = await this._orderModel.findById(new Types.ObjectId(oid)).exec();
    if (!order) {
      throw new NotFoundException('order_not_found');
    }

    await this.assertUserCanManageOrderStore(user, order);
    return this._orderPaidInvoiceEmail.resendPaidReceiptToClient(oid);
  }

  /**
   * Vendeur : refuse ou annule la commande avec motif structuré.
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

    if (user.type === UserTypeEnum.ADMIN) {
      throw new ForbiddenException('vendor_only');
    }
    if (user.type !== UserTypeEnum.VENDOR) {
      throw new ForbiddenException('vendor_or_admin_only');
    }

    const source = 'vendor' as const;

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

    await this.assertUserCanCancelOrderStore(user, order);

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
      prevStatus === OrderStatusEnum.APPROVED;
    if (
      wasPaid &&
      parentId.length > 0 &&
      !this.hasActiveRefundRequest(order.refundRequestLog)
    ) {
      const release =
        await this._stripeDeferredCapture.cancelAuthorizationIfUncaptured(
          parentId,
        );
      if (release !== 'cancelled') {
        const isPreOrder = order.isPreOrder === true;
        const autoDetails =
          source === 'vendor'
            ? isPreOrder
              ? 'Annulation pré-commande par le restaurant — remboursement client intégral (frais Stripe à la charge du restaurant).'
              : 'Annulation par le restaurant — remboursement client intégral (sans frais plateforme).'
            : source === 'admin'
              ? isPreOrder
                ? 'Annulation pré-commande par l’administration — remboursement à traiter.'
                : 'Annulation par l’administration — remboursement à traiter.'
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
    }

    await order.save();

    const storeId = this.storeIdFromOrderDoc(order);
    const customerId = this.userIdFromOrderDoc(order);
    await this.recordOrderStatusChangeIfLegacy({
      orderId: oid,
      storeId,
      customerUserId: customerId,
      fromStatus: prevStatus,
      toStatus: OrderStatusEnum.CANCELLED,
      source: OrderStatusChangeSourceEnum.VENDOR,
      actorUserId: String(user.id),
      note: `Refus : ${resolved.details}`.slice(0, 500),
    });

    if (customerId) {
      this.notifyOrderCancelledParties(order, {
        previousStatus: prevStatus,
        bodyOverride: 'Commande refusée ou annulée par le restaurant',
        note: resolved.details,
      });
    }

    if (this._orderDomainBridge?.enabled()) {
      void this._orderDomainBridge.emit({
        type: 'order.cancelled',
        payload: {
          orderId: oid,
          reason: resolved.details,
          source: 'vendor',
        },
        metadata: {
          actorUserId: String(user.id),
          orderContext: {
            fromStatus: prevStatus,
            source: OrderStatusChangeSourceEnum.VENDOR,
            ...this.buildOrderDomainDispatchContext(
              order,
              OrderStatusEnum.CANCELLED,
            ),
          },
        },
      });
    }
    this.notifyOrderPartiesRealtime(oid, OrderStatusEnum.CANCELLED);
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
    const { distanceKm, destinationLine, originLine, destinationLatitude, destinationLongitude } =
      this.resolveOrderTrackingGeo(order, isPickup);
    const vendorAcceptedRaw =
      (order as { vendorAcceptedAt?: Date | string }).vendorAcceptedAt ??
      (order as { vendor_accepted_at?: Date | string }).vendor_accepted_at;
    const vendorAcceptedAt =
      vendorAcceptedRaw instanceof Date
        ? vendorAcceptedRaw.toISOString()
        : typeof vendorAcceptedRaw === 'string' && vendorAcceptedRaw.trim()
          ? vendorAcceptedRaw.trim()
          : undefined;
    let progress = this.trackingProgressForStatus(status, isPickup);
    if (status === OrderStatusEnum.PAIED && vendorAcceptedAt) {
      progress = 0.22;
    }
    return {
      orderId: oid,
      status,
      isPickup,
      distanceKm,
      progress,
      destinationLine,
      originLine,
      ...(destinationLatitude != null && destinationLongitude != null
        ? { destinationLatitude, destinationLongitude }
        : {}),
      storeId: this.storeIdFromOrderDoc(order as OrderModel) ?? undefined,
      ...(vendorAcceptedAt ? { vendorAcceptedAt } : {}),
      ...this.courierRouteFieldsFromOrder(order as Record<string, unknown>),
    };
  }

  /** Polyline publiée par le livreur (si présente sur le doc commande). */
  private courierRouteFieldsFromOrder(
    order: Record<string, unknown>,
  ): Partial<OrderWsTrackingPayload> {
    const encoded = String(
      order.courierRoutePolyline ?? order.courier_route_polyline ?? '',
    ).trim();
    if (!encoded) return {};
    const formatRaw = String(
      order.courierRouteFormat ?? order.courier_route_format ?? 'google',
    ).trim();
    const format = formatRaw === 'google' ? 'google' : 'google';
    const legRaw = String(
      order.courierRouteLeg ?? order.courier_route_leg ?? '',
    ).trim();
    const leg =
      legRaw === 'to_store' ||
      legRaw === 'to_customer' ||
      legRaw === 'full'
        ? legRaw
        : undefined;
    const distanceMeters = Number(
      order.courierRouteDistanceM ?? order.courier_route_distance_m,
    );
    const durationSeconds = Number(
      order.courierRouteDurationS ?? order.courier_route_duration_s,
    );
    const updatedRaw =
      order.courierRouteUpdatedAt ?? order.courier_route_updated_at;
    const routeUpdatedAt =
      updatedRaw instanceof Date
        ? updatedRaw.toISOString()
        : typeof updatedRaw === 'string' && updatedRaw.trim()
          ? updatedRaw.trim()
          : undefined;
    return {
      routePolylineEncoded: encoded,
      routePolylineFormat: format,
      ...(leg ? { routeLeg: leg } : {}),
      ...(Number.isFinite(distanceMeters)
        ? { routeDistanceMeters: distanceMeters }
        : {}),
      ...(Number.isFinite(durationSeconds)
        ? { routeDurationSeconds: durationSeconds }
        : {}),
      ...(routeUpdatedAt ? { routeUpdatedAt } : {}),
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
    destinationLatitude?: number;
    destinationLongitude?: number;
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
        ...(storeCoords
          ? {
              destinationLatitude: storeCoords[1],
              destinationLongitude: storeCoords[0],
            }
          : {}),
      };
    }
    return {
      distanceKm,
      originLine: storeLine || undefined,
      destinationLine: userLine || undefined,
      ...(userCoords
        ? {
            destinationLatitude: userCoords[1],
            destinationLongitude: userCoords[0],
          }
        : {}),
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

  /**
   * Contexte WS pour le bus domaine (EDA-003) : parties + snapshot tracking.
   */
  buildOrderDomainDispatchContext(
    order: OrderModel | Record<string, unknown>,
    status: OrderStatusEnum,
    extra?: Partial<OrderWsTrackingPayload>,
  ): {
    customerUserId?: string;
    vendorUserId?: string;
    deliveryAgentId?: string;
    storeId?: string;
    wsTracking: OrderWsTrackingPayload;
  } {
    const orderRecord = order as Record<string, unknown>;
    const explicitAssigneeClear =
      extra != null &&
      'assignedDeliveryUserId' in extra &&
      extra.assignedDeliveryUserId == null;
    const extraAgentId =
      typeof extra?.assignedDeliveryUserId === 'string'
        ? extra.assignedDeliveryUserId.trim()
        : '';
    const baseDelivery = this.clientDeliveryAgentFlags(orderRecord);
    const agentId = explicitAssigneeClear
      ? null
      : (baseDelivery.assignedDeliveryUserId ??
        (extraAgentId.length > 0 ? extraAgentId : null));
    const delivery =
      agentId && !baseDelivery.assignedDeliveryUserId
        ? this.clientDeliveryAgentFlags({
            ...orderRecord,
            assignedDeliveryUser: agentId,
          })
        : baseDelivery;
    const wsTracking: OrderWsTrackingPayload = {
      ...this.buildOrderTrackingPayload(order, status),
      ...extra,
      ...(explicitAssigneeClear
        ? { assignedDeliveryUserId: null, canMessageDeliveryAgent: false }
        : agentId
          ? { assignedDeliveryUserId: agentId }
          : {}),
      canMessageDeliveryAgent: explicitAssigneeClear
        ? false
        : delivery.canMessageDeliveryAgent,
      deliveryChatArchived: delivery.deliveryChatArchived,
    };
    return {
      customerUserId:
        this.userIdFromOrderDoc(order as OrderModel) ?? undefined,
      vendorUserId:
        this.storeOwnerUserIdFromLean((order as { store?: unknown }).store) ??
        undefined,
      deliveryAgentId: agentId ?? undefined,
      storeId: this.storeIdFromOrderDoc(order as OrderModel) ?? undefined,
      wsTracking,
    };
  }

  async buildOrderDomainDispatchContextByOrderId(
    orderId: string,
    status: OrderStatusEnum,
    extra?: Partial<OrderWsTrackingPayload>,
  ): Promise<ReturnType<OrdersService['buildOrderDomainDispatchContext']> | null> {
    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) return null;
    const order = await this._orderModel
      .findById(new Types.ObjectId(oid))
      .populate({
        path: 'store',
        populate: [{ path: 'address' }],
      })
      .populate(OrdersService.orderUserWithAddressesPopulate)
      .exec();
    if (!order) return null;
    return this.buildOrderDomainDispatchContext(order, status, extra);
  }

  /** True si le bus domaine remplace l’audit inline (`order_status_events`). */
  domainEventsEnabled(): boolean {
    return this._orderDomainBridge?.enabled() ?? false;
  }

  /** Snapshot livraison complet (champs requis Mongo) pour correction admin. */
  buildDeliveryAddressSnapshotFromAdminUpdate(
    dto: {
      address: string;
      city?: string;
      zipCode?: string;
      country?: string;
      countryCode?: string;
      latitude: number;
      longitude: number;
    },
    previous?: OrderModel['deliveryAddressSnapshot'] | null,
  ): NonNullable<OrderModel['deliveryAddressSnapshot']> {
    const lat = Number(dto.latitude);
    const lng = Number(dto.longitude);
    const prev = previous ?? undefined;
    const countryCode = (
      dto.countryCode?.trim().toUpperCase().slice(0, 2) ||
      prev?.countryCode?.trim().toUpperCase().slice(0, 2) ||
      'CM'
    ).slice(0, 2);
    const zipCode =
      dto.zipCode?.trim() || prev?.zipCode?.trim() || '00000';
    const city = dto.city?.trim() || prev?.city?.trim() || '—';
    const country =
      dto.country?.trim() ||
      prev?.country?.trim() ||
      (countryCode === 'CM' ? 'Cameroun' : countryCode);
    const address = dto.address?.trim() || prev?.address?.trim() || '—';

    return {
      ...(prev?.label ? { label: prev.label } : {}),
      address,
      city,
      country,
      countryCode,
      zipCode,
      location: {
        type: 'Point',
        coordinates: [lng, lat],
      },
    };
  }

  /** Met à jour le snapshot adresse livraison déjà persisté et propage WS avec coords destination. */
  async updateDeliveryAddressAndNotify(orderDoc: OrderModel): Promise<{
    destinationLine?: string;
    destinationLatitude: number;
    destinationLongitude: number;
  }> {
    const status = orderDoc.status as OrderStatusEnum;
    const plain = orderDoc.toObject() as Record<string, unknown>;
    const tracking = this.buildOrderTrackingPayload(plain, status);
    const assignedAgentId = this.assignedDeliveryUserIdFromOrderDoc(plain);
    let extra: Partial<OrderWsTrackingPayload> = {
      ...tracking,
      deliveryAddressUpdated: true,
      ...(assignedAgentId ? { assignedDeliveryUserId: assignedAgentId } : {}),
    };

    if (status === OrderStatusEnum.SHIPPED) {
      const courier = await this.resolveShippedCourierCoordinates(
        orderDoc._id.toString(),
        plain,
      );
      if (courier) {
        const courierExtra = this.buildShippedCourierTrackingExtra(
          plain,
          courier.latitude,
          courier.longitude,
          status,
        );
        if (courierExtra) {
          extra = { ...extra, ...courierExtra };
        }
      }
    }

    this.notifyOrderPartiesRealtime(
      orderDoc,
      status,
      extra,
      assignedAgentId
        ? { additionalPartyUserIds: [assignedAgentId] }
        : undefined,
    );

    const snap = orderDoc.deliveryAddressSnapshot as
      | { location?: { coordinates?: number[] } }
      | undefined;
    const coords = snap?.location?.coordinates;
    const lng = coords?.[0] ?? tracking.destinationLongitude ?? 0;
    const lat = coords?.[1] ?? tracking.destinationLatitude ?? 0;

    this.logger.log(
      `[DeliveryMapRT] notify deliveryAddressUpdated orderId=${orderDoc._id.toString()} ` +
        `status=${status} assignee=${assignedAgentId ?? 'none'} ` +
        `dest=(${extra.destinationLatitude ?? lat},${extra.destinationLongitude ?? lng}) ` +
        `deliveryAddressUpdated=${extra.deliveryAddressUpdated === true}`,
    );

    return {
      destinationLine: tracking.destinationLine,
      destinationLatitude: lat,
      destinationLongitude: lng,
    };
  }

  /** WS temps réel immédiat (mobile / admin / vendeur). Toujours actif : le bus domaine peut être absent ou en retard. */
  notifyOrderPartiesRealtime(
    orderOrId: OrderModel | Record<string, unknown> | string,
    status: OrderStatusEnum,
    extra?: Partial<OrderWsTrackingPayload>,
    notifyOptions?: { additionalPartyUserIds?: string[] },
  ): void {
    if (status === OrderStatusEnum.COMPLETED && typeof orderOrId !== 'string') {
      const customerId = this.userIdFromOrderDoc(orderOrId);
      if (customerId) {
        void this._cacheLayer.bustRecommendationFeedsForUser(customerId);
      }
      void this.recordCourierDeliveryCompletionStats(orderOrId);
    }
    if (!this._wsOrderNotifyHandler) return;
    if (typeof orderOrId === 'string') {
      void this._wsOrderNotifyHandler.notifyPartiesByOrderId(
        orderOrId,
        status,
        extra,
        notifyOptions,
      );
      return;
    }
    this._wsOrderNotifyHandler.notifyPartiesFromDoc(
      orderOrId,
      status,
      extra,
      notifyOptions,
    );
  }

  /** Agrège durée / distance pour le score perf livreur. */
  private async recordCourierDeliveryCompletionStats(
    order: OrderModel | Record<string, unknown>,
  ): Promise<void> {
    if (!this._courierPerfStats) return;
    if (
      (order as { shouldShip?: boolean }).shouldShip !== true &&
      (order as { should_ship?: boolean }).should_ship !== true
    ) {
      return;
    }
    const agentId = this.assignedDeliveryUserIdFromOrderDoc(order);
    if (!agentId) return;
    const orderId =
      (order as { _id?: Types.ObjectId })._id?.toString() ??
      String((order as { id?: string }).id ?? '');
    if (!orderId || !Types.ObjectId.isValid(orderId)) return;

    let distanceKm: number | null = null;
    try {
      const store =
        (order as { store?: unknown }).store &&
        typeof (order as { store?: unknown }).store === 'object'
          ? ((
              order as {
                store: {
                  address?: { location?: { coordinates?: number[] } };
                };
              }
            ).store)
          : null;
      const storeCoords = store?.address?.location?.coordinates;
      const snap = (
        order as {
          deliveryAddressSnapshot?: {
            location?: { coordinates?: number[] };
          };
        }
      ).deliveryAddressSnapshot;
      const dest = snap?.location?.coordinates;
      if (
        Array.isArray(storeCoords) &&
        storeCoords.length >= 2 &&
        Array.isArray(dest) &&
        dest.length >= 2
      ) {
        distanceKm = +haversineDistance(
          [Number(storeCoords[0]), Number(storeCoords[1])],
          [Number(dest[0]), Number(dest[1])],
        ).toFixed(2);
      }
    } catch {
      distanceKm = null;
    }

    let durationSec: number | null = null;
    try {
      const timeline = await this._orderStatusEvents.listTimelineByOrderIds([
        orderId,
      ]);
      const events = timeline.get(orderId) ?? [];
      const shipped = [...events]
        .reverse()
        .find((e) => e.toStatus === OrderStatusEnum.SHIPPED);
      const completedAt = (order as { pickedUpAt?: Date | string }).pickedUpAt
        ? new Date(
            (order as { pickedUpAt: Date | string }).pickedUpAt,
          ).getTime()
        : Date.now();
      if (shipped?.createdAt) {
        const start = new Date(shipped.createdAt).getTime();
        if (Number.isFinite(start) && completedAt > start) {
          durationSec = Math.round((completedAt - start) / 1000);
        }
      }
    } catch {
      durationSec = null;
    }

    await this._courierPerfStats.recordCompletedDelivery({
      agentUserId: agentId,
      durationSec,
      distanceKm,
    });
  }

  /** Audit synchrone uniquement hors bus domaine (évite double enregistrement EDA-004). */
  async recordOrderStatusChangeIfLegacy(
    params: RecordOrderStatusChangeParams,
  ): Promise<void> {
    if (this.domainEventsEnabled()) return;
    await this._orderStatusEvents.record(params);
  }

  /** Émet `order.created` sur le bus (audit via `OrderDomainEventHandler`). */
  emitOrderCreatedFromDoc(order: OrderModel | Record<string, unknown>): void {
    if (!this._orderDomainBridge?.enabled()) return;
    const orderId =
      (order as { _id?: Types.ObjectId })._id?.toString() ??
      String((order as { id?: string }).id ?? '');
    const storeId = this.storeIdFromOrderDoc(order as OrderModel);
    const customerUserId = this.userIdFromOrderDoc(order as OrderModel);
    if (!orderId || !storeId || !customerUserId) return;
    void this._orderDomainBridge.emit({
      type: 'order.created',
      payload: {
        orderId,
        storeId,
        customerUserId,
        status: OrderStatusEnum.CREATED,
      },
      metadata: {
        actorUserId: customerUserId,
        source: 'orders',
        orderContext: {
          source: OrderStatusChangeSourceEnum.CHECKOUT,
          ...this.buildOrderDomainDispatchContext(order, OrderStatusEnum.CREATED),
        },
      },
    });
  }

  /** Expédition : bus domaine ou WS legacy selon flags. */
  emitOrderShippedFromDoc(
    order: OrderModel | Record<string, unknown>,
    opts: {
      prevStatus: OrderStatusEnum;
      assignedDeliveryUserId: string;
      actorUserId: string;
      source: OrderStatusChangeSourceEnum;
      courier?: string;
      courierTrackingExtra?: Partial<OrderWsTrackingPayload>;
    },
  ): void {
    const orderId =
      (order as { _id?: Types.ObjectId })._id?.toString() ??
      String((order as { id?: string }).id ?? '');
    if (!orderId) return;
    const notifyExtra: Partial<OrderWsTrackingPayload> = {
      assignedDeliveryUserId: opts.assignedDeliveryUserId,
      ...(opts.courierTrackingExtra ?? {}),
    };
    if (this._orderDomainBridge?.enabled()) {
      void this._orderDomainBridge.emit({
        type: 'order.shipped',
        payload: {
          orderId,
          assignedDeliveryUserId: opts.assignedDeliveryUserId,
          ...(opts.courier ? { courier: opts.courier } : {}),
        },
        metadata: {
          actorUserId: opts.actorUserId,
          orderContext: {
            fromStatus: opts.prevStatus,
            source: opts.source,
            ...this.buildOrderDomainDispatchContext(
              order,
              OrderStatusEnum.SHIPPED,
              notifyExtra,
            ),
          },
        },
      });
    }
    this.notifyOrderPartiesRealtime(
      order,
      OrderStatusEnum.SHIPPED,
      notifyExtra,
    );
  }

  /** Charge une commande peuplée pour dispatch WS (EDA-005). */
  async findOrderForWsNotify(orderId: string): Promise<OrderModel | null> {
    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) return null;
    return this._orderModel
      .findById(new Types.ObjectId(oid))
      .populate({
        path: 'store',
        populate: [{ path: 'address' }],
      })
      .populate(OrdersService.orderUserWithAddressesPopulate)
      .exec();
  }

  /** Projection minimale pour ticks GPS (OPT-002). */
  private async findOrderForCourierTracking(
    orderId: string,
  ): Promise<Record<string, unknown> | null> {
    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) return null;
    const doc = await this._orderModel
      .findById(new Types.ObjectId(oid))
      .select(OrdersService.orderTrackingCourierSelect)
      .populate(OrdersService.orderTrackingCourierPopulate)
      .lean()
      .exec();
    return doc as Record<string, unknown> | null;
  }

  /** Commandes SHIPPED actives d’un livreur — une requête batch (OPT-002). */
  async findShippedOrdersForCourierTracking(
    agentUserId: string,
  ): Promise<Record<string, unknown>[]> {
    const agentId = agentUserId.trim();
    if (!Types.ObjectId.isValid(agentId)) return [];
    const docs = await this._orderModel
      .find({
        assignedDeliveryUser: new Types.ObjectId(agentId),
        shouldShip: true,
        status: OrderStatusEnum.SHIPPED,
      })
      .select(OrdersService.orderTrackingCourierSelect)
      .populate(OrdersService.orderTrackingCourierPopulate)
      .lean()
      .exec();
    return docs as Record<string, unknown>[];
  }

  /**
   * Pousse la position GPS pour toutes les courses SHIPPED d’un livreur (batch OPT-002).
   * Retourne les ids commande traités (pour émission `agent.location.updated`).
   */
  async publishCourierPositionsForAgent(
    agentUserId: string,
    courierLat: number,
    courierLng: number,
    telemetry?: CourierLiveTelemetry | null,
  ): Promise<string[]> {
    const orders = await this.findShippedOrdersForCourierTracking(agentUserId);
    const orderIds: string[] = [];
    for (const order of orders) {
      const oid =
        (order._id as Types.ObjectId | undefined)?.toString?.() ??
        String(order._id ?? '').trim();
      if (!oid) continue;
      orderIds.push(oid);
      this.emitCourierPositionFromOrderDoc(
        order,
        courierLat,
        courierLng,
        agentUserId,
        telemetry,
      );
    }
    return orderIds;
  }

  /** Prépare le snapshot tracking GPS sans publier d’événement domaine. */
  async prepareCourierPositionNotify(
    orderId: string,
    courierLat: number,
    courierLng: number,
  ): Promise<{
    order: OrderModel | Record<string, unknown>;
    status: OrderStatusEnum;
    extra: Partial<OrderWsTrackingPayload>;
  } | null> {
    const plain = await this.findOrderForCourierTracking(orderId);
    if (!plain) return null;
    const status = String(plain.status ?? '') as OrderStatusEnum;
    if (status !== OrderStatusEnum.SHIPPED) return null;
    const extra = this.buildShippedCourierTrackingExtra(
      plain,
      courierLat,
      courierLng,
      status,
    );
    if (!extra) return null;
    return { order: plain, status, extra };
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

    void this._wsOrderNotifyHandler?.notifyPartiesByOrderId(
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

    // Livraison sans assignee : auto-assign le vendeur pour que shipping+tip
    // partent sur le Connect boutique (même flux que le livreur).
    if (!isPickup && order.shouldShip === true) {
      const existingAssignee = this.assignedDeliveryUserIdFromOrderDoc(order);
      if (!existingAssignee) {
        await this.assertVendorSelfDeliveryConnectReady(user, order);
        order.set(
          'assignedDeliveryUser',
          new Types.ObjectId(String(user._id ?? user.id)),
        );
      }
    }

    const prevStatus = st;
    const pickedUpAt = new Date();
    order.status = OrderStatusEnum.COMPLETED;
    order.pickedUpAt = pickedUpAt;
    if (order.payOnPickup === true) {
      const dueTotal = Math.max(0, Number(order.totalPrice) || 0);
      const collected =
        dto.collectedAmount != null && Number.isFinite(dto.collectedAmount)
          ? Math.max(0, dto.collectedAmount)
          : dueTotal;
      order.cashCollectedAmount = collected;
      order.cashCollectedAt = pickedUpAt;
      order.cashCollectionVariance =
        Math.round((collected - dueTotal) * 100 + Number.EPSILON) / 100;
    }
    await order.save();

    if (order.payOnPickup === true) {
      void this.ensurePaidReceiptEmail(oid);
    }

    const storeId = this.storeIdFromOrderDoc(order);
    const customerId = this.userIdFromOrderDoc(order);
    await this.recordOrderStatusChangeIfLegacy({
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
    if (this._orderDomainBridge?.enabled()) {
      void this._orderDomainBridge.emit({
        type: 'order.delivered',
        payload: { orderId: oid },
        metadata: {
          actorUserId: String(user.id),
          orderContext: {
            fromStatus: prevStatus,
            source: OrderStatusChangeSourceEnum.VENDOR,
            ...this.buildOrderDomainDispatchContext(
              populated ?? order,
              OrderStatusEnum.COMPLETED,
            ),
          },
        },
      });
    }
    this.notifyOrderPartiesRealtime(
      populated ?? order,
      OrderStatusEnum.COMPLETED,
    );
    this.notifyStoreVendorsForOrderStatusChange(order, {
      reason: 'order_completed',
      status: OrderStatusEnum.COMPLETED,
      isPickup,
      note: isPickup ? 'Retrait confirmé' : 'Livraison confirmée',
    });

    if (!this.domainEventsEnabled()) {
      void this._loyaltyService
        .creditOrderCompletion(oid)
        .catch((err) =>
          this.logger.warn(
            `Loyalty credit order=${oid}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );

      void this._wsChatNotify.archiveOrderChats(
        oid,
        isPickup ? 'order_pickup_completed' : 'order_delivered',
      );
    }

    const deliveryAgentId = this.assignedDeliveryUserIdFromOrderDoc(order);
    if (deliveryAgentId && !isPickup) {
      void this._deliveryAgentService.publishPresenceWs(
        deliveryAgentId,
        'order_completed',
      );
    }

    if (!isPickup && order.shouldShip === true) {
      this.scheduleDeliveryAgentPayouts(oid);
    }

    this.enqueueGraphOrderCompleted(order, {
      userId: customerId,
      storeId: storeId ?? undefined,
    });

    return {
      orderId: oid,
      status: OrderStatusEnum.COMPLETED,
      pickedUpAt,
    };
  }

  /**
   * Livreur assigné : valide le code retrait / livraison → `completed`.
   */
  async confirmHandoffByDeliveryAgent(
    orderId: string,
    user: UserModel,
    dto: ConfirmPickupDto,
  ): Promise<{
    orderId: string;
    status: OrderStatusEnum;
    pickedUpAt: Date;
  }> {
    if (user.type !== UserTypeEnum.DELIVERY) {
      throw new ForbiddenException('delivery_agent_only');
    }

    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) {
      throw new NotFoundException('order_not_found');
    }

    const agentId = objectIdStringFromRef(user._id ?? user.id);
    if (!agentId) {
      throw new ForbiddenException('delivery_agent_only');
    }
    const order = await this._orderModel
      .findById(new Types.ObjectId(oid))
      .populate('store', 'name owner')
      .exec();
    if (!order) {
      throw new NotFoundException('order_not_found');
    }

    const assignee =
      order.assignedDeliveryUser ??
      (order as unknown as Record<string, unknown>).assignedDeliveryUser;
    if (!mongoIdsEqual(assignee, agentId)) {
      throw new ForbiddenException('order_not_assigned_to_agent');
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
    } else if (st !== OrderStatusEnum.SHIPPED) {
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
    // 1. Persist statut (Seule écriture bloquante avant réponse HTTP).
    await order.save();

    const storeId = this.storeIdFromOrderDoc(order);
    const customerId = this.userIdFromOrderDoc(order);

    // 2. WS immédiat (doc déjà en mémoire) — UI livreur/client sans attendre audit/populate.
    this.notifyOrderPartiesRealtime(order, OrderStatusEnum.COMPLETED);
    void this._deliveryAgentService.publishPresenceWs(
      agentId,
      'order_completed',
    );

    // 3. Side-effects DB / FCM / domaine en arrière-plan (fail-open).
    void this._afterCourierHandoffCompletedSideEffects({
      oid,
      order,
      user,
      agentId,
      prevStatus,
      storeId,
      customerId,
      isPickup,
    });

    return {
      orderId: oid,
      status: OrderStatusEnum.COMPLETED,
      pickedUpAt,
    };
  }

  /**
   * Post-handoff livreur : audit, populate, bus domaine, FCM, loyalty, payouts.
   * Ne bloque jamais la réponse HTTP (WS déjà émis).
   */
  private async _afterCourierHandoffCompletedSideEffects(args: {
    oid: string;
    order: OrderModel;
    user: UserModel;
    agentId: string;
    prevStatus: OrderStatusEnum;
    storeId?: string;
    customerId?: string;
    isPickup: boolean;
  }): Promise<void> {
    const {
      oid,
      order,
      user,
      agentId,
      prevStatus,
      storeId,
      customerId,
      isPickup,
    } = args;
    try {
      await this.recordOrderStatusChangeIfLegacy({
        orderId: oid,
        storeId,
        customerUserId: customerId,
        fromStatus: prevStatus,
        toStatus: OrderStatusEnum.COMPLETED,
        source: OrderStatusChangeSourceEnum.DELIVERY_AGENT,
        actorUserId: agentId,
        note: isPickup
          ? 'Retrait confirmé par le livreur (code validé)'
          : 'Livraison confirmée par le livreur (code validé)',
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

      if (this._orderDomainBridge?.enabled()) {
        void this._orderDomainBridge.emit({
          type: 'order.delivered',
          payload: { orderId: oid },
          metadata: {
            actorUserId: String(user.id),
            orderContext: {
              fromStatus: prevStatus,
              source: OrderStatusChangeSourceEnum.DELIVERY_AGENT,
              ...this.buildOrderDomainDispatchContext(
                populated ?? order,
                OrderStatusEnum.COMPLETED,
              ),
            },
          },
        });
      }

      this.notifyStoreVendorsForOrderStatusChange(order, {
        reason: 'order_completed',
        status: OrderStatusEnum.COMPLETED,
        isPickup,
        note: isPickup ? 'Retrait confirmé' : 'Livraison confirmée',
      });

      if (!this.domainEventsEnabled()) {
        void this._loyaltyService
          .creditOrderCompletion(oid)
          .catch((err) =>
            this.logger.warn(
              `Loyalty credit order=${oid}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            ),
          );

        void this._wsChatNotify.archiveOrderChats(
          oid,
          isPickup ? 'order_pickup_completed' : 'order_delivered',
        );
      }

      if (!isPickup && order.shouldShip === true) {
        this.scheduleDeliveryAgentPayouts(oid);
      }

      this.enqueueGraphOrderCompleted(order, {
        userId: customerId,
        storeId: storeId ?? undefined,
      });
    } catch (err) {
      this.logger.warn(
        `afterCourierHandoff side-effects order=${oid}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Admin valide une livraison « client absent » après confirmation client.
   */
  async completeDeliveryFromPendingProof(args: {
    orderId: string;
    actorUserId?: string;
    note?: string;
    source?: OrderStatusChangeSourceEnum;
  }): Promise<{
    orderId: string;
    status: OrderStatusEnum;
    pickedUpAt: Date;
  }> {
    const oid = args.orderId.trim();
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
    if (order.shouldShip !== true) {
      throw new BadRequestException('delivery_only');
    }
    const st = order.status as OrderStatusEnum;
    if (st === OrderStatusEnum.COMPLETED) {
      return {
        orderId: oid,
        status: OrderStatusEnum.COMPLETED,
        pickedUpAt: order.pickedUpAt ?? new Date(),
      };
    }
    if (st !== OrderStatusEnum.SHIPPED) {
      throw new BadRequestException('delivery_confirm_invalid_status');
    }

    const source =
      args.source ?? OrderStatusChangeSourceEnum.DASHBOARD;
    const agentId = this.assignedDeliveryUserIdFromOrderDoc(order);
    const prevStatus = st;
    const pickedUpAt = new Date();
    order.status = OrderStatusEnum.COMPLETED;
    order.pickedUpAt = pickedUpAt;
    await order.save();

    const storeId = this.storeIdFromOrderDoc(order);
    const customerId = this.userIdFromOrderDoc(order);
    await this.recordOrderStatusChangeIfLegacy({
      orderId: oid,
      storeId,
      customerUserId: customerId,
      fromStatus: prevStatus,
      toStatus: OrderStatusEnum.COMPLETED,
      source,
      actorUserId: args.actorUserId ?? agentId ?? undefined,
      note:
        args.note?.trim() ||
        (source === OrderStatusChangeSourceEnum.DELIVERY_AGENT
          ? 'Livraison confirmée par le livreur (client absent, preuve photo)'
          : 'Livraison validée par admin (client absent, preuve photo)'),
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
            `FCM order completed pending proof: ${
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

    if (this._orderDomainBridge?.enabled()) {
      void this._orderDomainBridge.emit({
        type: 'order.delivered',
        payload: { orderId: oid },
        metadata: {
          actorUserId: args.actorUserId,
          orderContext: {
            fromStatus: prevStatus,
            source,
            ...this.buildOrderDomainDispatchContext(
              populated ?? order,
              OrderStatusEnum.COMPLETED,
            ),
          },
        },
      });
    }

    this.notifyOrderPartiesRealtime(
      populated ?? order,
      OrderStatusEnum.COMPLETED,
    );
    this.notifyStoreVendorsForOrderStatusChange(order, {
      reason: 'order_completed',
      status: OrderStatusEnum.COMPLETED,
      isPickup: false,
      note: args.note?.trim() || 'Livraison validée (client absent)',
    });

    if (!this.domainEventsEnabled()) {
      void this._loyaltyService
        .creditOrderCompletion(oid)
        .catch((err) =>
          this.logger.warn(
            `Loyalty credit order=${oid}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        );

      void this._wsChatNotify.archiveOrderChats(oid, 'order_delivered');
    }

    if (agentId) {
      void this._deliveryAgentService.publishPresenceWs(
        agentId,
        'order_completed',
      );
    }

    if (order.shouldShip === true) {
      this.scheduleDeliveryAgentPayouts(oid);
    }

    this.enqueueGraphOrderCompleted(order, {
      userId: customerId,
      storeId: storeId ?? undefined,
    });

    return {
      orderId: oid,
      status: OrderStatusEnum.COMPLETED,
      pickedUpAt,
    };
  }

  /**
   * Après dépôt client-absent (commande encore SHIPPED) : recalcule présence livreur
   * hors course active pour les clients temps réel.
   */
  notifyDeliveryAgentPresenceAfterDutyRelease(agentUserId: string): void {
    const uid = agentUserId?.trim();
    if (!uid) return;
    void this._deliveryAgentService.publishPresenceWs(uid, 'order_completed');
  }

  /** Fire-and-forget sync Neo4j (gated GRAPH_SYNC) — fail-open. */
  private enqueueGraphOrderCompleted(
    order: OrderModel,
    opts?: { userId?: string; storeId?: string },
  ): void {
    if (!this._graphSyncQueue) return;
    const payload = buildGraphOrderCompletedPayload(order, opts);
    if (!payload) return;
    void this._graphSyncQueue
      .enqueueOrderCompleted(payload)
      .catch((err) =>
        this.logger.warn(
          `graph-sync order completed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
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
      (order as Record<string, unknown>).assignedDeliveryUser;
    if (raw == null) return null;
    if (typeof raw === 'object' && '_id' in (raw as object)) {
      const id = String((raw as { _id: unknown })._id).trim();
      return id.length > 0 ? id : null;
    }
    const id = String(raw).trim();
    return id.length > 0 ? id : null;
  }

  private scheduleDeliveryAgentPayouts(orderId: string): void {
    void (async () => {
      try {
        // Séquentiel : frais livraison (net retenue plateforme) puis tip.
        const shipTr =
          await this._stripeTransfers.transferDeliveryShareForCompletedOrder({
            orderId,
          });
        if (!shipTr.transferred && shipTr.skippedReason) {
          this.logger.warn(
            `Delivery Connect transfer skipped order=${orderId}: ${shipTr.skippedReason}`,
          );
        }

        const tipTr =
          await this._stripeTransfers.transferDeliveryTipForCompletedOrder({
            orderId,
          });
        if (!tipTr.transferred && tipTr.skippedReason) {
          this.logger.warn(
            `Delivery tip transfer skipped order=${orderId}: ${tipTr.skippedReason}`,
          );
        }

        if (shipTr.transferred || tipTr.transferred) {
          await this.settleDeliveryBadgePayoutForOrder(orderId);
        }
      } catch (err) {
        this.logger.warn(
          `Delivery Connect payouts error order=${orderId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    })();
  }

  /** Déclenche le versement badge partenaire du livreur assigné après un transfer réussi. */
  private async settleDeliveryBadgePayoutForOrder(
    orderId: string,
  ): Promise<void> {
    try {
      const order = await this._orderModel
        .findById(orderId)
        .select('assignedDeliveryUser')
        .lean()
        .exec();
      const agentId = order?.assignedDeliveryUser
        ? String(order.assignedDeliveryUser)
        : '';
      if (!agentId) return;
      await this._deliveryAgentService.settleDeliveryBadgePayoutAfterTransfer(
        agentId,
      );
    } catch (err) {
      this.logger.warn(
        `Delivery badge payout settle failed order=${orderId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private userIdFromOrderDoc(
    order: OrderModel | Record<string, unknown>,
  ): string | undefined {
    const raw = (order as { user?: unknown }).user as unknown;
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
    await this._storeAccess.assertStoreAccess(user, storeId, 'orders.manage');
  }

  private async assertUserCanCancelOrderStore(
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
    await this._storeAccess.assertStoreAccess(user, storeId, 'orders.cancel');
  }

  /** Client : annule une commande cash à la collecte (sans journal remboursement Stripe). */
  private async cancelPayOnPickupOrderByClient(
    order: OrderModel,
    user: UserModel,
    dto: CreateRefundRequestDto,
    oid: string,
  ): Promise<{ orderId: string; status: OrderStatusEnum }> {
    const st = order.status as OrderStatusEnum;
    if (!isOrderStatusCancellablePayOnPickup(st)) {
      throw new BadRequestException('refund_not_applicable_status');
    }

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
      note: `Annulation client (collecte) : ${resolved.details}`.slice(0, 500),
    });

    this.notifyOrderCancelledParties(order, {
      previousStatus: prevStatus,
      bodyOverride: 'Commande annulée',
      note: `Annulation client (collecte) : ${resolved.details}`,
    });

    void this._wsOrderNotifyHandler?.notifyPartiesByOrderId(
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
      status: OrderStatusEnum.CANCELLED,
    };
  }

  /** Client : annule une pré-commande impayée (statut `created`). */
  private async cancelUnpaidPreOrderByClient(
    order: OrderModel,
    user: UserModel,
    dto: CreateRefundRequestDto,
    oid: string,
  ): Promise<{ orderId: string; status: OrderStatusEnum }> {
    const st = order.status as OrderStatusEnum;
    if (st !== OrderStatusEnum.CREATED || order.isPreOrder !== true) {
      throw new BadRequestException('refund_not_applicable_status');
    }

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
      note: `Annulation pré-commande : ${resolved.details}`.slice(0, 500),
    });

    this.notifyOrderCancelledParties(order, {
      previousStatus: prevStatus,
      bodyOverride: 'Pré-commande annulée',
      note: `Annulation client : ${resolved.details}`,
    });

    void this._wsOrderNotifyHandler?.notifyPartiesByOrderId(
      oid,
      OrderStatusEnum.CANCELLED,
    );
    this.notifyStoreVendorsForOrderStatusChange(order, {
      reason: 'order_cancelled',
      status: OrderStatusEnum.CANCELLED,
      note: `Pré-commande annulée : ${resolved.details}`,
    });

    return {
      orderId: oid,
      status: OrderStatusEnum.CANCELLED,
    };
  }

  /**
   * Admin plateforme : ajoute une note sur la commande et notifie le vendeur
   * (inbox ADMIN + push FCM, catégorie Commandes).
   */
  async addAdminOrderNoteAndNotifyVendor(
    orderId: string,
    user: UserModel,
    rawNote: string,
  ): Promise<{
    orderId: string;
    note: string;
    adminNotesCount: number;
  }> {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }

    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) {
      throw new NotFoundException('order_not_found');
    }

    const note = normalizeAdminOrderNote(rawNote);
    if (!note) {
      throw new BadRequestException('admin_note_empty');
    }

    // JWT user : id virtuel ou _id Mongo selon le contexte d’auth.
    const authorUserId = String(user._id ?? user.id ?? '').trim();
    if (!authorUserId) {
      throw new ForbiddenException('admin_only');
    }

    const entry = {
      note,
      authorUserId,
      createdAt: new Date(),
    };

    const order = await this._orderModel
      .findByIdAndUpdate(
        new Types.ObjectId(oid),
        { $push: { adminNotes: entry } },
        { new: true },
      )
      .populate('store', 'name')
      .exec();
    if (!order) {
      throw new NotFoundException('order_not_found');
    }

    const storeId = this.storeIdFromOrderDoc(order);
    if (!storeId) {
      throw new BadRequestException('order_store_missing');
    }

    const storeName = this.storeNameFromPopulated(order.store);
    const orderIdStr = order._id.toString();
    const inboxMessage = buildAdminOrderNoteInboxMessage({
      orderId: orderIdStr,
      note,
    });
    const push = buildAdminOrderNotePush({
      orderId: orderIdStr,
      note,
      storeName,
    });

    // Push + inbox uniquement (pas d’e-mail statut — message libre admin).
    void this.notifyStoreVendorsForOrder({
      storeId,
      customerUserId: this.userIdFromOrderDoc(order),
      inboxMessage,
      inboxFrom: 'ADMIN',
      push: {
        title: push.title,
        body: push.body,
        orderId: orderIdStr,
        storeName,
        reason: push.reason,
        status: String(order.status ?? ''),
      },
      logTag: 'admin_order_note',
    });

    const count = Array.isArray(order.adminNotes) ? order.adminNotes.length : 1;
    return {
      orderId: orderIdStr,
      note,
      adminNotesCount: count,
    };
  }

  /**
   * Client : met à jour la note sur une pré-commande.
   */
  async patchPreOrderCustomerNote(
    orderId: string,
    user: UserModel,
    customerNote: string,
  ): Promise<{ orderId: string; customerNote: string }> {
    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) {
      throw new NotFoundException('order_not_found');
    }
    const note = customerNote.trim();
    const order = await this._orderModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(oid),
          user: new Types.ObjectId(String(user.id)),
          isPreOrder: true,
          status: {
            $nin: [
              OrderStatusEnum.CANCELLED,
              OrderStatusEnum.COMPLETED,
            ],
          },
        },
        { $set: { customerNote: note || undefined } },
        { new: true },
      )
      .select('_id customerNote')
      .exec();
    if (!order) {
      throw new NotFoundException('order_not_found');
    }
    return {
      orderId: String(order._id),
      customerNote: String(order.customerNote ?? ''),
    };
  }

  /**
   * Client propriétaire : note sur commande (Mes commandes).
   * Note non vide → inbox CLIENT + push vendeur. Vide → efface sans notif.
   */
  async patchCustomerOrderNoteAndNotifyVendor(
    orderId: string,
    user: UserModel,
    rawNote: string,
  ): Promise<{ orderId: string; customerNote: string }> {
    if (user.type === UserTypeEnum.ADMIN || user.type === UserTypeEnum.VENDOR) {
      throw new ForbiddenException('customer_only');
    }

    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) {
      throw new NotFoundException('order_not_found');
    }

    const note = normalizeCustomerOrderNote(rawNote);
    const ownerOid = new Types.ObjectId(String(user._id ?? user.id));

    const existing = await this._orderModel
      .findOne({
        _id: new Types.ObjectId(oid),
        user: ownerOid,
      })
      .select('_id status')
      .exec();
    if (!existing) {
      throw new NotFoundException('order_not_found');
    }
    if (!customerOrderNoteAllowedStatuses(String(existing.status ?? ''))) {
      throw new BadRequestException('customer_note_order_closed');
    }

    const order = await this._orderModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(oid),
          user: ownerOid,
          status: {
            $nin: [OrderStatusEnum.CANCELLED, OrderStatusEnum.COMPLETED],
          },
        },
        note
          ? { $set: { customerNote: note } }
          : { $unset: { customerNote: 1 } },
        { new: true },
      )
      .populate('store', 'name')
      .exec();
    if (!order) {
      throw new NotFoundException('order_not_found');
    }

    // Notifier seulement si une note utile est présente.
    if (note) {
      const storeId = this.storeIdFromOrderDoc(order);
      if (storeId) {
        const storeName = this.storeNameFromPopulated(order.store);
        const orderIdStr = order._id.toString();
        const inboxMessage = buildCustomerOrderNoteInboxMessage({
          orderId: orderIdStr,
          note,
        });
        const push = buildCustomerOrderNotePush({
          orderId: orderIdStr,
          note,
          storeName,
        });
        void this.notifyStoreVendorsForOrder({
          storeId,
          customerUserId: this.userIdFromOrderDoc(order),
          inboxMessage,
          inboxFrom: 'CLIENT',
          push: {
            title: push.title,
            body: push.body,
            orderId: orderIdStr,
            storeName,
            reason: push.reason,
            status: String(order.status ?? ''),
          },
          logTag: 'customer_order_note',
        });
      }
    }

    return {
      orderId: String(order._id),
      customerNote: String(order.customerNote ?? ''),
    };
  }

  /**
   * Client : enregistre une demande de remboursement (historique sur la commande).
   * Refus si statut commande / livraison incompatible ou si une demande est déjà en cours / traitée.
   */
  async submitRefundRequest(
    orderId: string,
    user: UserModel,
    dto: CreateRefundRequestDto,
  ): Promise<{
    orderId: string;
    status: OrderRefundRequestEntryStatusEnum | OrderStatusEnum;
  }> {
    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) {
      throw new NotFoundException('order_not_found');
    }
    const uid = new Types.ObjectId(String(user.id));
    const order = await this._orderModel
      .findOne({ _id: new Types.ObjectId(oid), user: uid })
      .select(
        'status shouldShip payOnPickup isPreOrder vendorAcceptedAt refundRequestLog store items totalPrice currency pickupCode user stripeParentPaymentId',
      )
      .populate('store', 'name')
      .exec();
    if (!order) {
      throw new NotFoundException('order_not_found');
    }
    const st = order.status as OrderStatusEnum;
    if (order.isPreOrder === true && st === OrderStatusEnum.CREATED) {
      return this.cancelUnpaidPreOrderByClient(order, user, dto, oid);
    }
    if (
      order.isPreOrder === true &&
      readVendorAcceptedAt(order as unknown as Record<string, unknown>) !=
        null
    ) {
      throw new BadRequestException('pre_order_vendor_already_accepted');
    }
    if (order.payOnPickup === true) {
      return this.cancelPayOnPickupOrderByClient(order, user, dto, oid);
    }
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

    this.notifyOrderCancelledParties(order, {
      previousStatus: prevStatus,
      bodyOverride: order.isPreOrder
        ? 'Pré-commande annulée — remboursement en cours d’examen'
        : 'Commande annulée — remboursement en cours d’examen',
      note: `Annulation client : ${resolved.details}`,
    });

    void this._wsOrderNotifyHandler?.notifyPartiesByOrderId(
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
    const plain = await this.findOrderForCourierTracking(orderId);
    if (!plain) return;
    const agentId =
      this.assignedDeliveryUserIdFromOrderDoc(plain) ??
      '';
    this.emitCourierPositionFromOrderDoc(
      plain,
      courierLat,
      courierLng,
      agentId,
    );
  }

  private emitCourierPositionFromOrderDoc(
    plain: Record<string, unknown>,
    courierLat: number,
    courierLng: number,
    agentUserId: string,
    telemetry?: CourierLiveTelemetry | null,
  ): void {
    const oid =
      (plain._id as Types.ObjectId | undefined)?.toString?.() ??
      String(plain._id ?? '').trim();
    if (!oid) return;

    const status = String(plain.status ?? '') as OrderStatusEnum;
    if (status !== OrderStatusEnum.SHIPPED) return;

    if (
      !this.courierGpsThrottle.shouldPublish(
        agentUserId,
        oid,
        courierLat,
        courierLng,
      )
    ) {
      return;
    }

    const extra = this.buildShippedCourierTrackingExtra(
      plain,
      courierLat,
      courierLng,
      status,
      telemetry,
    );
    if (!extra) return;

    if (this._orderDomainBridge?.enabled()) {
      void this._orderDomainBridge.emit({
        id: domainEventIdFromCourierTracking(
          agentUserId,
          oid,
          courierLat,
          courierLng,
          this.courierGpsThrottle.throttleMs(),
          this.courierGpsThrottle.coordPrecision(),
        ),
        type: 'order.tracking.updated',
        payload: {
          orderId: oid,
          latitude: courierLat,
          longitude: courierLng,
        },
        metadata: {
          orderContext: this.buildOrderDomainDispatchContext(
            plain,
            status,
            extra,
          ),
        },
      });
    }
    this.notifyOrderPartiesRealtime(plain, status, extra);
  }

  private buildShippedCourierTrackingExtra(
    plain: Record<string, unknown>,
    courierLat: number,
    courierLng: number,
    status: OrderStatusEnum,
    telemetry?: CourierLiveTelemetry | null,
  ): Partial<OrderWsTrackingPayload> | null {
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

    const tel = normalizeCourierLiveTelemetry(telemetry);
    const telFields = courierTelemetryWsFields(tel);

    return {
      distanceKm: totalKm,
      remainingDistanceKm: remainingKm,
      progress,
      courierLatitude: courierLat,
      courierLongitude: courierLng,
      ...(telFields as Partial<OrderWsTrackingPayload>),
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

  /** Client : avis livreur après livraison terminée. */
  async submitCourierOrderRating(
    orderId: string,
    user: UserModel,
    dto: CreateCourierOrderRatingDto,
  ) {
    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) {
      throw new NotFoundException('order_not_found');
    }

    const order = await this._orderModel.findById(new Types.ObjectId(oid)).exec();
    if (!order) {
      throw new NotFoundException('order_not_found');
    }

    const customerId = String(order.user ?? '');
    if (customerId !== String(user.id)) {
      throw new ForbiddenException('order_forbidden');
    }

    if ((order.status as OrderStatusEnum) !== OrderStatusEnum.COMPLETED) {
      throw new BadRequestException('order_not_completed');
    }
    if (order.shouldShip !== true) {
      throw new BadRequestException('order_not_delivery');
    }

    const agentId = this.assignedDeliveryUserIdFromOrderDoc(order);
    if (!agentId) {
      throw new BadRequestException('courier_not_assigned');
    }

    const rating = await this._ratingsService.createCourierOrderRating(
      dto,
      order,
      agentId,
      user,
    );

    return {
      ok: true,
      orderId: oid,
      ratingId: String(rating._id),
    };
  }
}
