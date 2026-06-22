import { Injectable, Logger } from '@nestjs/common';
import { WsNotifyDispatchQueueService } from './ws-notify-dispatch-queue.service';
import type { PublicPlatformMaintenanceResponse } from '@modules/maintenance-alerts/platform-maintenance.util';

@Injectable()
export class WsPlatformMaintenanceNotifyService {
  private readonly logger = new Logger(WsPlatformMaintenanceNotifyService.name);

  constructor(private readonly queue: WsNotifyDispatchQueueService) {}

  broadcastStatus(snapshot: PublicPlatformMaintenanceResponse): void {
    try {
      this.queue.dispatch('platform/maintenance', {
        ...snapshot,
        type: 'platform_maintenance',
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ws platform maintenance notify enqueue failed: ${msg}`);
    }
  }
}
