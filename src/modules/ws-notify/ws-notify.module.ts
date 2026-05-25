import { Module } from '@nestjs/common';
import { WsChatNotifyService } from './ws-chat-notify.service';
import { WsInboxNotifyService } from './ws-inbox-notify.service';
import { WsOrderNotifyService } from './ws-order-notify.service';
import { WsStripeConnectNotifyService } from './ws-stripe-connect-notify.service';

@Module({
  providers: [
    WsInboxNotifyService,
    WsOrderNotifyService,
    WsStripeConnectNotifyService,
    WsChatNotifyService,
  ],
  exports: [
    WsInboxNotifyService,
    WsOrderNotifyService,
    WsStripeConnectNotifyService,
    WsChatNotifyService,
  ],
})
export class WsNotifyModule {}
