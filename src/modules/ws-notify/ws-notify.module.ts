import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  InfraRuntimeSettingsModel,
  InfraRuntimeSettingsSchema,
} from '@schemas/infra-runtime-settings.schema';
import { WsAdManagerNotifyService } from './ws-ad-manager-notify.service';
import { WsAdsTargetingNotifyService } from './ws-ads-targeting-notify.service';
import { WsChatNotifyService } from './ws-chat-notify.service';
import { WsDeliveryAgentNotifyService } from './ws-delivery-agent-notify.service';
import { WsInboxNotifyService } from './ws-inbox-notify.service';
import { WsNotifyDispatchQueueService } from './ws-notify-dispatch-queue.service';
import { WsOrderNotifyService } from './ws-order-notify.service';
import { WsStripeConnectNotifyService } from './ws-stripe-connect-notify.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: InfraRuntimeSettingsModel.name,
        schema: InfraRuntimeSettingsSchema,
      },
    ]),
  ],
  providers: [
    WsNotifyDispatchQueueService,
    WsInboxNotifyService,
    WsOrderNotifyService,
    WsStripeConnectNotifyService,
    WsChatNotifyService,
    WsAdsTargetingNotifyService,
    WsAdManagerNotifyService,
    WsDeliveryAgentNotifyService,
  ],
  exports: [
    WsNotifyDispatchQueueService,
    WsInboxNotifyService,
    WsOrderNotifyService,
    WsStripeConnectNotifyService,
    WsChatNotifyService,
    WsAdsTargetingNotifyService,
    WsAdManagerNotifyService,
    WsDeliveryAgentNotifyService,
  ],
})
export class WsNotifyModule {}
