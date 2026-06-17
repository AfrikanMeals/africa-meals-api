import { Injectable, Logger } from '@nestjs/common';
import { WsNotifyDispatchQueueService } from './ws-notify-dispatch-queue.service';

export type OrderWsTrackingPayload = {
  orderId: string;
  status: string;
  isPickup: boolean;
  distanceKm?: number;
  progress?: number;
  destinationLine?: string;
  originLine?: string;
  pickupCode?: string;
  courierLatitude?: number;
  courierLongitude?: number;
  remainingDistanceKm?: number;
  elapsedMinutes?: number;
  /** Livreur mobile assigné (`User` DELIVERY) — chat client ↔ livreur. */
  assignedDeliveryUserId?: string;
  canMessageDeliveryAgent?: boolean;
  /** Fil client↔livreur archivé (commande livrée) — messagerie toujours ouverte. */
  deliveryChatArchived?: boolean;
};

/**
 * Pousse `order:update` / `order:tracking` sur le salon Socket.IO `user:{customerId}` (africa-meals-ws).
 */
@Injectable()
export class WsOrderNotifyService {
  private readonly logger = new Logger(WsOrderNotifyService.name);

  constructor(private readonly queue: WsNotifyDispatchQueueService) {}

  notifyCustomerOrderUpdate(
    userId: string,
    payload: OrderWsTrackingPayload,
  ): void {
    this.postInternal('order/update', userId, payload);
  }

  notifyCustomerOrderTracking(
    userId: string,
    payload: OrderWsTrackingPayload,
  ): void {
    this.postInternal('order/tracking', userId, payload);
  }

  /** Un seul dispatch MQTT/BullMQ — WS émet update + tracking (OPT-005). */
  notifyCustomerOrderChanged(
    userId: string,
    payload: OrderWsTrackingPayload,
  ): void {
    this.postInternal('order/changed', userId, payload);
  }

  /** Salon `orders:admin` — comptes ADMIN connectés sur l’app admin. */
  notifyStaffOrderBroadcast(payload: OrderWsTrackingPayload): void {
    this.postInternalStaff('order/staff-broadcast', payload);
  }

  private postInternal(
    pathSuffix: 'order/update' | 'order/tracking' | 'order/changed',
    userId: string,
    payload: OrderWsTrackingPayload,
  ): void {
    const uid = userId?.trim();
    const orderId = payload.orderId?.trim();
    if (!uid || !orderId) return;

    try {
      this.queue.dispatch(pathSuffix, { userId: uid, ...payload });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `ws order notify enqueue (${pathSuffix}) failed: ${msg}`,
      );
    }
  }

  private postInternalStaff(
    pathSuffix: 'order/staff-broadcast',
    payload: OrderWsTrackingPayload,
  ): void {
    const orderId = payload.orderId?.trim();
    if (!orderId) return;

    try {
      this.queue.dispatch(pathSuffix, payload);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `ws order notify enqueue (${pathSuffix}) failed: ${msg}`,
      );
    }
  }
}
