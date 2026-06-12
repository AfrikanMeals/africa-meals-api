import { Injectable, Logger } from '@nestjs/common';
import { WsNotifyDispatchQueueService } from './ws-notify-dispatch-queue.service';

/**
 * Appels internes africa-meals-ws liés au chat (archivage fil livreur, etc.).
 */
@Injectable()
export class WsChatNotifyService {
  private readonly logger = new Logger(WsChatNotifyService.name);

  constructor(private readonly queue: WsNotifyDispatchQueueService) {}

  /** Archive les discussions liées à une commande (livreur + restaurant) quand elle est terminée. */
  archiveOrderChats(orderId: string, reason = 'order_completed'): void {
    const oid = orderId?.trim();
    if (!oid) return;

    try {
      this.queue.dispatch('chat/archive-order-delivery', {
        orderId: oid,
        reason,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ws chat archive enqueue failed order=${oid}: ${msg}`);
    }
  }

  /** @deprecated Utiliser archiveOrderChats */
  archiveOrderDeliveryChats(orderId: string): void {
    this.archiveOrderChats(orderId, 'order_completed');
  }
}
