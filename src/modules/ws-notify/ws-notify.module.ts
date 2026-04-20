import { Module } from '@nestjs/common';
import { WsInboxNotifyService } from './ws-inbox-notify.service';

@Module({
  providers: [WsInboxNotifyService],
  exports: [WsInboxNotifyService],
})
export class WsNotifyModule {}
