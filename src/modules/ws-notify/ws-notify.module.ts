import { Module } from '@nestjs/common';
import { WsInboxNotifyService } from './ws-inbox-notify.service';
import { WsOrderNotifyService } from './ws-order-notify.service';

@Module({
  providers: [WsInboxNotifyService, WsOrderNotifyService],
  exports: [WsInboxNotifyService, WsOrderNotifyService],
})
export class WsNotifyModule {}
