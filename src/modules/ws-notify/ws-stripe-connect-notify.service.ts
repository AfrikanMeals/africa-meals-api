import { Injectable, Logger } from '@nestjs/common';
import { WsNotifyDispatchQueueService } from './ws-notify-dispatch-queue.service';

/**
 * Pousse `stripe:connect:status` sur le salon Socket.IO `user:{vendorId}` (africa-meals-ws).
 */
@Injectable()
export class WsStripeConnectNotifyService {
  private readonly logger = new Logger(WsStripeConnectNotifyService.name);

  constructor(private readonly queue: WsNotifyDispatchQueueService) {}

  notifyVendorConnectStatus(
    userId: string,
    status: Record<string, unknown>,
  ): void {
    const uid = userId?.trim();
    if (!uid) return;

    try {
      this.queue.dispatch('stripe/connect-status', { userId: uid, status });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ws stripe connect notify enqueue failed: ${msg}`);
    }
  }
}
