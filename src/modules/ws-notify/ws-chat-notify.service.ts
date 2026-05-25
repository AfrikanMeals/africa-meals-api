import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Appels internes africa-meals-ws liés au chat (archivage fil livreur, etc.).
 */
@Injectable()
export class WsChatNotifyService {
  private readonly logger = new Logger(WsChatNotifyService.name);

  constructor(private readonly config: ConfigService) {}

  /** Archive les discussions ORDER client↔livreur quand la commande est livrée. */
  archiveOrderDeliveryChats(orderId: string): void {
    const oid = orderId?.trim();
    if (!oid) return;

    const raw = this.config.get<string>('AFRICA_MEALS_WS_INTERNAL_URL')?.trim();
    const secret =
      this.config.get<string>('INTERNAL_NOTIFY_SECRET')?.trim() ||
      this.config.get<string>('INTERNAL_WS_NOTIFY_SECRET')?.trim();
    if (!raw || !secret) {
      return;
    }

    const base = raw.replace(/\/+$/, '');
    const path = base.endsWith('/api')
      ? `${base}/internal/chat/archive-order-delivery`
      : `${base}/api/internal/chat/archive-order-delivery`;

    void fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      body: JSON.stringify({ orderId: oid }),
      signal: AbortSignal.timeout(8000),
    }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ws chat archive failed order=${oid}: ${msg}`);
    });
  }
}
