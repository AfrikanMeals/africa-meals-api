import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { OrdersService } from '@modules/orders/orders.service';
import {
  OrderWsTrackingPayload,
  WsOrderNotifyService,
} from '@modules/ws-notify/ws-order-notify.service';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';

/**
 * Dispatch WS commande (`order:update` / `order:tracking`) — extrait de OrdersService (EDA-005).
 * Utilisé par `OrderDomainEventHandler` quand `DOMAIN_EVENTS_WS_VIA_BUS=false`,
 * ou directement hors bus domaine.
 */
@Injectable()
export class WsOrderNotifyHandler {
  constructor(
    private readonly wsOrderNotify: WsOrderNotifyService,
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
  ) {}

  notifyPartiesFromDoc(
    order: OrderModel | Record<string, unknown>,
    status: OrderStatusEnum,
    extra?: Partial<OrderWsTrackingPayload>,
  ): void {
    const ctx = this.orders.buildOrderDomainDispatchContext(order, status, extra);
    this.dispatchToParties(ctx.wsTracking, ctx);
  }

  async notifyPartiesByOrderId(
    orderId: string,
    status: OrderStatusEnum,
    extra?: Partial<OrderWsTrackingPayload>,
  ): Promise<void> {
    const order = await this.orders.findOrderForWsNotify(orderId);
    if (!order) return;
    this.notifyPartiesFromDoc(order, status, extra);
  }

  /** GPS livreur — chemin legacy WS (sans republier `order.tracking.updated`). */
  async notifyCourierTracking(
    orderId: string,
    courierLat: number,
    courierLng: number,
  ): Promise<void> {
    const prepared = await this.orders.prepareCourierPositionNotify(
      orderId,
      courierLat,
      courierLng,
    );
    if (!prepared) return;
    this.notifyPartiesFromDoc(
      prepared.order,
      prepared.status,
      prepared.extra,
    );
  }

  private dispatchToParties(
    tracking: OrderWsTrackingPayload,
    parties: {
      customerUserId?: string;
      vendorUserId?: string;
      deliveryAgentId?: string;
    },
  ): void {
    const customerId = parties.customerUserId?.trim();
    if (customerId) {
      this.wsOrderNotify.notifyCustomerOrderUpdate(customerId, tracking);
      this.wsOrderNotify.notifyCustomerOrderTracking(customerId, tracking);
    }
    const vendorId = parties.vendorUserId?.trim();
    if (vendorId && vendorId !== customerId) {
      this.wsOrderNotify.notifyCustomerOrderUpdate(vendorId, tracking);
      this.wsOrderNotify.notifyCustomerOrderTracking(vendorId, tracking);
    }
    const deliveryAgentId = parties.deliveryAgentId?.trim();
    if (
      deliveryAgentId &&
      deliveryAgentId !== customerId &&
      deliveryAgentId !== vendorId
    ) {
      this.wsOrderNotify.notifyCustomerOrderUpdate(deliveryAgentId, tracking);
      this.wsOrderNotify.notifyCustomerOrderTracking(deliveryAgentId, tracking);
    }
    this.wsOrderNotify.notifyStaffOrderBroadcast(tracking);
  }
}
