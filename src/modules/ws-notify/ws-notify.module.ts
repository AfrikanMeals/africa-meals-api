import { Module } from '@nestjs/common';
import { WsAdsTargetingNotifyService } from './ws-ads-targeting-notify.service';
import { WsChatNotifyService } from './ws-chat-notify.service';
import { WsInboxNotifyService } from './ws-inbox-notify.service';
import { WsNotifyDispatchQueueService } from './ws-notify-dispatch-queue.service';
import { WsOrderNotifyService } from './ws-order-notify.service';
import { WsStripeConnectNotifyService } from './ws-stripe-connect-notify.service';

@Module({
  providers: [
    WsNotifyDispatchQueueService,
    WsInboxNotifyService,
    WsOrderNotifyService,
    WsStripeConnectNotifyService,
    WsChatNotifyService,
    WsAdsTargetingNotifyService,
  ],
  exports: [
    WsInboxNotifyService,
    WsOrderNotifyService,
    WsStripeConnectNotifyService,
    WsChatNotifyService,
    WsAdsTargetingNotifyService,
  ],
})
export class WsNotifyModule {}
