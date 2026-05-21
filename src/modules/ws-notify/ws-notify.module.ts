import { Module } from '@nestjs/common';
import { WsInboxNotifyService } from './ws-inbox-notify.service';
import { WsOrderNotifyService } from './ws-order-notify.service';
import { WsStripeConnectNotifyService } from './ws-stripe-connect-notify.service';

@Module({
  providers: [
    WsInboxNotifyService,
    WsOrderNotifyService,
    WsStripeConnectNotifyService,
  ],
  exports: [
    WsInboxNotifyService,
    WsOrderNotifyService,
    WsStripeConnectNotifyService,
  ],
})
export class WsNotifyModule {}
