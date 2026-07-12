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
  /** Coordonnées destination livraison (client) — déplacement marqueur carte temps réel. */
  destinationLatitude?: number;
  destinationLongitude?: number;
  pickupCode?: string;
  courierLatitude?: number;
  courierLongitude?: number;
  remainingDistanceKm?: number;
  elapsedMinutes?: number;
  /** Livreur mobile assigné (`User` DELIVERY) — chat client ↔ livreur ; `null` = retrait explicite. */
  assignedDeliveryUserId?: string | null;
  canMessageDeliveryAgent?: boolean;
  /** Fil client↔livreur archivé (commande livrée) — messagerie toujours ouverte. */
  deliveryChatArchived?: boolean;
  /** Boutique concernée — salon WS `store:{storeId}` (équipe vendeur). */
  storeId?: string;
  /** Prise en charge vendeur (préparation) — ISO8601. */
  vendorAcceptedAt?: string;
  /** Adresse livraison modifiée (admin) — resync cartes livreur / client. */
  deliveryAddressUpdated?: boolean;
  /** Preuve livraison « client absent » — resync admin livraisons en attente. */
  pendingDeliveryProofId?: string;
  pendingDeliveryProofStatus?: string;
  /** Cascade auto-offer flotte boutique. */
  deliveryOfferStatus?: 'offered' | 'accepted' | 'exhausted' | 'expired' | 'rejected';
  deliveryOfferId?: string;
  deliveryOfferAgentUserId?: string;
  deliveryOfferExpiresAt?: string;
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

  /** GRPC-112 — un RPC batch pour toutes les parties + staff. */
  notifyOrderPartiesBatch(
    tracking: OrderWsTrackingPayload,
    userIds: string[],
  ): void {
    const orderId = tracking.orderId?.trim();
    if (!orderId) return;
    const uniqueIds = [...new Set(userIds.map((id) => id.trim()).filter(Boolean))];
    const items: Array<{ pathSuffix: string; payload: Record<string, unknown> }> =
      uniqueIds.map((userId) => ({
        pathSuffix: 'order/changed',
        payload: { userId, ...tracking },
      }));
    items.push({
      pathSuffix: 'order/staff-broadcast',
      payload: tracking as unknown as Record<string, unknown>,
    });
    try {
      this.queue.batchDispatch(items);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ws order batch notify failed: ${msg}`);
    }
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
