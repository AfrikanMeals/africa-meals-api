import { Injectable, Logger } from '@nestjs/common';
import { WsNotifyDispatchQueueService } from './ws-notify-dispatch-queue.service';

@Injectable()
export class WsAdsTargetingNotifyService {
  private readonly logger = new Logger(WsAdsTargetingNotifyService.name);

  constructor(private readonly queue: WsNotifyDispatchQueueService) {}

  broadcastEventIngested(payload: {
    received: number;
    queued: number;
    eventType: string;
    placement?: string | null;
  }): void {
    try {
      this.queue.dispatch('ads-targeting/event', payload);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`ws ads targeting notify enqueue failed: ${msg}`);
    }
  }
}
