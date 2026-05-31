import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class WsAdsTargetingNotifyService {
  private readonly logger = new Logger(WsAdsTargetingNotifyService.name);

  constructor(private readonly config: ConfigService) {}

  broadcastEventIngested(payload: {
    received: number;
    queued: number;
    eventType: string;
    placement?: string | null;
  }): void {
    const raw = this.config.get<string>('AFRICA_MEALS_WS_INTERNAL_URL')?.trim();
    const secret =
      this.config.get<string>('INTERNAL_NOTIFY_SECRET')?.trim() ||
      this.config.get<string>('INTERNAL_WS_NOTIFY_SECRET')?.trim();
    if (!raw || !secret) return;
    const base = raw.replace(/\/+$/, '');
    const path = base.endsWith('/api')
      ? `${base}/internal/ads-targeting/event`
      : `${base}/api/internal/ads-targeting/event`;
    void fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ws ads targeting notify failed: ${msg}`);
    });
  }
}
