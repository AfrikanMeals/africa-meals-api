import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Pousse `stripe:connect:status` sur le salon Socket.IO `user:{vendorId}` (africa-meals-ws).
 */
@Injectable()
export class WsStripeConnectNotifyService {
  private readonly logger = new Logger(WsStripeConnectNotifyService.name);

  constructor(private readonly config: ConfigService) {}

  notifyVendorConnectStatus(
    userId: string,
    status: Record<string, unknown>,
  ): void {
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
      ? `${base}/internal/stripe/connect-status`
      : `${base}/api/internal/stripe/connect-status`;

    void fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      body: JSON.stringify({ userId: uid, status }),
      signal: AbortSignal.timeout(8000),
    }).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ws stripe connect notify failed: ${msg}`);
    });
  }
}
