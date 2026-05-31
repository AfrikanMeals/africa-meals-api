import { Injectable, Logger } from '@nestjs/common';
import { WsNotifyDispatchQueueService } from './ws-notify-dispatch-queue.service';

/**
 * Notifie le service africa-meals-ws pour pousser `inbox:feed:refresh` sur le salon Socket.IO `user:{id}`.
 * Évite le polling HTTP du fil `GET /stores/vendor/notifications` côté admin.
 *
 * Variables : `AFRICA_MEALS_WS_INTERNAL_URL` (ex. https://ws.example.com ou http://localhost:8000),
 * `INTERNAL_NOTIFY_SECRET` (même valeur que sur le WS pour `/internal/inbox/refresh`).
 */
@Injectable()
export class WsInboxNotifyService {
  private readonly logger = new Logger(WsInboxNotifyService.name);

  constructor(private readonly queue: WsNotifyDispatchQueueService) {}

  notifyUserInboxRefresh(userId: string): void {
    const uid = userId?.trim();
    if (!uid) return;
    try {
      this.queue.dispatch('inbox/refresh', { userId: uid });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ws inbox notify enqueue failed: ${msg}`);
    }
  }
}
