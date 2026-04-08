import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

  constructor(private readonly config: ConfigService) {}

  notifyUserInboxRefresh(userId: string): void {
    const uid = userId?.trim();
    if (!uid) return;
    const raw = this.config.get<string>('AFRICA_MEALS_WS_INTERNAL_URL')?.trim();
    const secret =
      this.config.get<string>('INTERNAL_NOTIFY_SECRET')?.trim() ||
      this.config.get<string>('INTERNAL_WS_NOTIFY_SECRET')?.trim();
    if (!raw || !secret) {
      return;
    }
    const base = raw.replace(/\/+$/, '');
    const path = base.endsWith('/api')
      ? `${base}/internal/inbox/refresh`
      : `${base}/api/internal/inbox/refresh`;
    void fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      body: JSON.stringify({ userId: uid }),
      signal: AbortSignal.timeout(8000),
    }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ws inbox notify failed: ${msg}`);
    });
  }
}
