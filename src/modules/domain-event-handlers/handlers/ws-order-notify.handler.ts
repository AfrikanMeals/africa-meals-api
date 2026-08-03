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
    notifyOptions?: { additionalPartyUserIds?: string[] },
  ): void {
    const ctx = this.orders.buildOrderDomainDispatchContext(order, status, extra);
    this.dispatchToParties(ctx.wsTracking, ctx, notifyOptions);
  }

  notifyPartiesFromOrderContext(
    orderId: string,
    status: OrderStatusEnum,
    metadata?: {
      orderContext?: Record<string, unknown>;
    },
  ): void {
    const ctx = (metadata?.orderContext ?? {}) as Record<string, unknown>;
    const wsTracking = ctx.wsTracking;
    if (
      wsTracking &&
      typeof wsTracking === 'object' &&
      typeof (wsTracking as OrderWsTrackingPayload).orderId === 'string'
    ) {
      this.dispatchToParties(wsTracking as OrderWsTrackingPayload, {
        customerUserId:
          typeof ctx.customerUserId === 'string' ? ctx.customerUserId : undefined,
        vendorUserId:
          typeof ctx.vendorUserId === 'string' ? ctx.vendorUserId : undefined,
        deliveryAgentId:
          typeof ctx.deliveryAgentId === 'string'
            ? ctx.deliveryAgentId
            : undefined,
      });
      return;
    }
    void this.notifyPartiesByOrderId(orderId, status);
  }

  async notifyPartiesByOrderId(
    orderId: string,
    status: OrderStatusEnum,
    extra?: Partial<OrderWsTrackingPayload>,
    notifyOptions?: { additionalPartyUserIds?: string[] },
  ): Promise<void> {
    const order = await this.orders.findOrderForWsNotify(orderId);
    if (!order) return;
    this.notifyPartiesFromDoc(order, status, extra, notifyOptions);
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
    notifyOptions?: { additionalPartyUserIds?: string[] },
  ): void {
    const targets: string[] = [];
    const customerId = parties.customerUserId?.trim();
    if (customerId) targets.push(customerId);
    const vendorId = parties.vendorUserId?.trim();
    if (vendorId && vendorId !== customerId) targets.push(vendorId);
    const deliveryAgentId = parties.deliveryAgentId?.trim();
    if (
      deliveryAgentId &&
      deliveryAgentId !== customerId &&
      deliveryAgentId !== vendorId
    ) {
      targets.push(deliveryAgentId);
    }
    for (const uid of notifyOptions?.additionalPartyUserIds ?? []) {
      const id = uid.trim();
      if (id) targets.push(id);
    }
    // Seul le client reçoit pickupCode ; vendeur / livreur / équipe boutique non.
    this.wsOrderNotify.notifyOrderPartiesBatch(
      tracking,
      targets,
      customerId ? [customerId] : [],
    );
  }
}
