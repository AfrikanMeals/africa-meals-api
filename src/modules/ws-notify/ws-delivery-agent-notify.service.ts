import { Injectable, Logger } from '@nestjs/common';
import { WsNotifyDispatchQueueService } from './ws-notify-dispatch-queue.service';

export type DeliveryAgentPresenceWsPayload = {
  agentUserId: string;
  availability: 'disponible' | 'hors_ligne';
  presence: 'disponible' | 'en_livraison' | 'hors_ligne';
  activeOrderCount: number;
  maxConcurrentOrders: number;
  storeIds?: string[];
  reason?:
    | 'manual_toggle'
    | 'order_assigned'
    | 'order_completed'
    | 'order_unassigned'
    | 'admin_toggle';
};

/**
 * Pousse `delivery-agent:presence` sur le salon Socket.IO `user:{agentUserId}`
 * et sur `orders:admin` (liste livreurs admin).
 */
@Injectable()
export class WsDeliveryAgentNotifyService {
  private readonly logger = new Logger(WsDeliveryAgentNotifyService.name);

  constructor(private readonly queue: WsNotifyDispatchQueueService) {}

  notifyPresence(payload: DeliveryAgentPresenceWsPayload): void {
    const uid = payload.agentUserId?.trim();
    if (!uid) return;
    try {
      this.queue.dispatch('delivery-agent/presence', {
        userId: uid,
        agentUserId: uid,
        availability: payload.availability,
        presence: payload.presence,
        activeOrderCount: payload.activeOrderCount,
        maxConcurrentOrders: payload.maxConcurrentOrders,
        reason: payload.reason ?? 'manual_toggle',
        ...(payload.storeIds?.length ? { storeIds: payload.storeIds } : {}),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ws delivery-agent presence notify failed: ${msg}`);
    }
  }
}
