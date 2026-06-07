import { Injectable, Logger } from '@nestjs/common';
import { WsNotifyDispatchQueueService } from './ws-notify-dispatch-queue.service';

/**
 * Diffuse les événements publicitaires (impression/clic/conversion bannière ou
 * campagne) vers le flux live de l'Ad Manager admin (salon WS `ad-manager:stream`).
 */
@Injectable()
export class WsAdManagerNotifyService {
  private readonly logger = new Logger(WsAdManagerNotifyService.name);

  constructor(private readonly queue: WsNotifyDispatchQueueService) {}

  broadcastAdEvent(payload: {
    scope: 'BANNER' | 'CAMPAIGN';
    eventType: string;
    entityId: string;
    storeId?: string | null;
    itemType?: string | null;
  }): void {
    try {
      this.queue.dispatch('ad-manager/event', { ...payload });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ws ad manager notify enqueue failed: ${msg}`);
    }
  }
}
