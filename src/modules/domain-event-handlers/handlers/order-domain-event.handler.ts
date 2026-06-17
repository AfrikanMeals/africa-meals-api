import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainEventEnvelope } from '../../../common/domain-events/domain-event.types';
import {
  OrderApprovedPayload,
  OrderCancelledPayload,
  OrderCreatedPayload,
  OrderDeliveredPayload,
  OrderPaidPayload,
  OrderShippedPayload,
  OrderTrackingUpdatedPayload,
} from '../../../common/domain-events/payloads/order-domain-event.payloads';
import { AdsService } from '@modules/ads/ads.service';
import { LoyaltyService } from '@modules/loyalty/loyalty.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { OrderPaidInvoiceEmailService } from '@modules/orders/order-paid-invoice-email.service';
import { OrderStatusEventsService } from '@modules/orders/order-status-events.service';
import { OrdersService } from '@modules/orders/orders.service';
import { WsChatNotifyService } from '@modules/ws-notify/ws-chat-notify.service';
import { OrderStatusEnum } from '@schemas/order.schema';
import { OrderStatusChangeSourceEnum } from '@schemas/order-status-event.schema';
import { CartItemTypeEnum } from '@schemas/cart_item.schema';
import { Types } from 'mongoose';
import { isDomainEventsWsViaBus } from '../domain-event-handlers.util';
import { WsOrderNotifyHandler } from './ws-order-notify.handler';

@Injectable()
export class OrderDomainEventHandler {
  private readonly logger = new Logger(OrderDomainEventHandler.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
    private readonly orderStatusEvents: OrderStatusEventsService,
    private readonly notifications: NotificationsService,
    private readonly invoiceEmail: OrderPaidInvoiceEmailService,
    private readonly loyalty: LoyaltyService,
    private readonly ads: AdsService,
    private readonly wsChat: WsChatNotifyService,
    private readonly wsOrderNotify: WsOrderNotifyHandler,
  ) {}

  async handle(envelope: DomainEventEnvelope): Promise<void> {
    switch (envelope.type) {
      case 'order.created':
        await this.onCreated(
          envelope.payload as OrderCreatedPayload,
          envelope.metadata,
        );
        break;
      case 'order.paid':
        await this.onPaid(
          envelope.payload as OrderPaidPayload,
          envelope.metadata,
        );
        break;
      case 'order.approved':
        await this.onApproved(
          envelope.payload as OrderApprovedPayload,
          envelope.metadata,
        );
        break;
      case 'order.shipped':
        await this.onShipped(
          envelope.payload as OrderShippedPayload,
          envelope.metadata,
        );
        break;
      case 'order.delivered':
        await this.onDelivered(
          envelope.payload as OrderDeliveredPayload,
          envelope.metadata,
        );
        break;
      case 'order.cancelled':
        await this.onCancelled(
          envelope.payload as OrderCancelledPayload,
          envelope.metadata,
        );
        break;
      case 'order.tracking.updated':
        await this.onTrackingUpdated(
          envelope.payload as OrderTrackingUpdatedPayload,
        );
        break;
      default:
        break;
    }
  }

  private wsViaBus(): boolean {
    return isDomainEventsWsViaBus(this.config);
  }

  private async onCreated(
    payload: OrderCreatedPayload,
    metadata?: DomainEventEnvelope['metadata'],
  ): Promise<void> {
    await this.orderStatusEvents.record({
      orderId: payload.orderId,
      storeId: payload.storeId,
      customerUserId: payload.customerUserId,
      toStatus: OrderStatusEnum.CREATED,
      source: OrderStatusChangeSourceEnum.CHECKOUT,
      actorUserId: metadata?.actorUserId ?? payload.customerUserId,
    });
  }

  private async onPaid(
    payload: OrderPaidPayload,
    metadata?: DomainEventEnvelope['metadata'],
  ): Promise<void> {
    const ctx = metadata?.orderContext ?? {};
    const prevStatus = String(ctx.fromStatus ?? '');
    if (prevStatus !== OrderStatusEnum.PAIED) {
      await this.orderStatusEvents.record({
        orderId: payload.orderId,
        storeId: payload.storeId,
        customerUserId: payload.customerUserId,
        fromStatus: prevStatus || undefined,
        toStatus: OrderStatusEnum.PAIED,
        source: OrderStatusChangeSourceEnum.STRIPE,
      });
      void this.notifications
        .pushCustomerOrderStatusChanged({
          userId: payload.customerUserId,
          orderId: payload.orderId,
          storeId: payload.storeId,
          previousStatus: prevStatus,
          newStatus: OrderStatusEnum.PAIED,
        })
        .catch((err) => this.logWarn('FCM order paid', err));
      if (!this.wsViaBus()) {
        void this.wsOrderNotify.notifyPartiesByOrderId(
          payload.orderId,
          OrderStatusEnum.PAIED,
        );
      }
      void this.invoiceEmail
        .sendForPaidOrder(payload.orderId)
        .catch((err) => this.logWarn('invoice email', err));
      void this.loyalty
        .creditOrderCompletion(payload.orderId)
        .catch((err) => this.logWarn('loyalty credit', err));
      const itemRefs = Array.isArray(ctx.paidItemRefs)
        ? (ctx.paidItemRefs as { itemType: string; entityId: string }[])
        : [];
      if (itemRefs.length > 0) {
        void this.ads
          .trackOrderConversions({
            orderId: payload.orderId,
            userId: payload.customerUserId,
            storeId: payload.storeId,
            items: itemRefs.filter(
              (item) =>
                (item.itemType === CartItemTypeEnum.PRODUCT ||
                  item.itemType === CartItemTypeEnum.DRINK) &&
                Types.ObjectId.isValid(item.entityId),
            ),
          })
          .catch((err) => this.logWarn('ads conversion', err));
      }
    }
    void this.orders
      .ensureVendorPaidOrderNotifications(payload.orderId)
      .catch((err) => this.logWarn('vendor paid notify', err));
  }

  private async onApproved(
    payload: OrderApprovedPayload,
    metadata?: DomainEventEnvelope['metadata'],
  ): Promise<void> {
    await this.recordTransition(payload.orderId, OrderStatusEnum.APPROVED, metadata);
    if (!this.wsViaBus()) {
      void this.wsOrderNotify.notifyPartiesByOrderId(
        payload.orderId,
        OrderStatusEnum.APPROVED,
      );
    }
  }

  private async onShipped(
    payload: OrderShippedPayload,
    metadata?: DomainEventEnvelope['metadata'],
  ): Promise<void> {
    await this.recordTransition(payload.orderId, OrderStatusEnum.SHIPPED, metadata);
    if (!this.wsViaBus()) {
      void this.wsOrderNotify.notifyPartiesByOrderId(
        payload.orderId,
        OrderStatusEnum.SHIPPED,
      );
    }
  }

  private async onDelivered(
    payload: OrderDeliveredPayload,
    metadata?: DomainEventEnvelope['metadata'],
  ): Promise<void> {
    await this.recordTransition(payload.orderId, OrderStatusEnum.COMPLETED, metadata);
    if (!this.wsViaBus()) {
      void this.wsOrderNotify.notifyPartiesByOrderId(
        payload.orderId,
        OrderStatusEnum.COMPLETED,
      );
    }
    void this.wsChat.archiveOrderChats(payload.orderId, 'order_completed');
    void this.loyalty
      .creditOrderCompletion(payload.orderId)
      .catch((err) => this.logWarn('loyalty completion', err));
  }

  private async onCancelled(
    payload: OrderCancelledPayload,
    metadata?: DomainEventEnvelope['metadata'],
  ): Promise<void> {
    await this.recordTransition(payload.orderId, OrderStatusEnum.CANCELLED, metadata);
    if (!this.wsViaBus()) {
      void this.wsOrderNotify.notifyPartiesByOrderId(
        payload.orderId,
        OrderStatusEnum.CANCELLED,
      );
    }
    void this.wsChat.archiveOrderChats(payload.orderId, 'order_cancelled');
  }

  private async onTrackingUpdated(
    payload: OrderTrackingUpdatedPayload,
  ): Promise<void> {
    if (this.wsViaBus()) return;
    await this.wsOrderNotify.notifyCourierTracking(
      payload.orderId,
      payload.latitude,
      payload.longitude,
    );
  }

  private async recordTransition(
    orderId: string,
    toStatus: OrderStatusEnum,
    metadata?: DomainEventEnvelope['metadata'],
  ): Promise<void> {
    const ctx = metadata?.orderContext ?? {};
    await this.orderStatusEvents.record({
      orderId,
      storeId: ctx.storeId as string | undefined,
      customerUserId: ctx.customerUserId as string | undefined,
      fromStatus: ctx.fromStatus as string | undefined,
      toStatus,
      source:
        (ctx.source as OrderStatusChangeSourceEnum | undefined) ??
        OrderStatusChangeSourceEnum.SYSTEM,
      actorUserId: metadata?.actorUserId,
    });
  }

  private logWarn(label: string, err: unknown): void {
    this.logger.warn(
      `${label}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
