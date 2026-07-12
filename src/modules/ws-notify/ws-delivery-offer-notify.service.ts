import { Injectable, Logger } from '@nestjs/common';
import { WsNotifyDispatchQueueService } from './ws-notify-dispatch-queue.service';

export type DeliveryOfferWsPayload = {
  userId: string;
  orderId: string;
  offerId: string;
  storeId?: string;
  storeName?: string;
  orderRef?: string;
  rank?: number;
  distanceMeters?: number | null;
  expiresAt?: string;
  offeredAt?: string;
  timeoutSec?: number;
  status: 'pending' | 'expired' | 'cancelled' | 'accepted' | 'rejected';
};

export type DeliveryOfferStaffSignal = {
  orderId: string;
  storeId?: string;
  status: string;
  isPickup?: boolean;
  deliveryOfferStatus: string;
  deliveryOfferId?: string;
  deliveryOfferAgentUserId?: string;
  deliveryOfferExpiresAt?: string;
  assignedDeliveryUserId?: string;
};

/**
 * Pousse `order:delivery-offer` vers le livreur (`user:{id}`)
 * et signale le staff via `order/staff-broadcast`.
 */
@Injectable()
export class WsDeliveryOfferNotifyService {
  private readonly logger = new Logger(WsDeliveryOfferNotifyService.name);

  constructor(private readonly queue: WsNotifyDispatchQueueService) {}

  notifyOffer(payload: DeliveryOfferWsPayload): void {
    const uid = payload.userId?.trim();
    const orderId = payload.orderId?.trim();
    const offerId = payload.offerId?.trim();
    if (!uid || !orderId || !offerId) return;
    try {
      this.queue.dispatch('order/delivery-offer', {
        ...payload,
        userId: uid,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ws delivery-offer notify failed: ${msg}`);
    }
  }

  notifyStaffOfferSignal(payload: DeliveryOfferStaffSignal): void {
    const orderId = payload.orderId?.trim();
    if (!orderId) return;
    try {
      this.queue.dispatch('order/staff-broadcast', {
        orderId,
        status: payload.status,
        isPickup: payload.isPickup ?? false,
        storeId: payload.storeId,
        deliveryOfferStatus: payload.deliveryOfferStatus,
        deliveryOfferId: payload.deliveryOfferId,
        deliveryOfferAgentUserId: payload.deliveryOfferAgentUserId,
        deliveryOfferExpiresAt: payload.deliveryOfferExpiresAt,
        assignedDeliveryUserId: payload.assignedDeliveryUserId,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ws delivery-offer staff signal failed: ${msg}`);
    }
  }
}
