import { AdsModule } from '@modules/ads/ads.module';
import { GraphModule } from '@modules/graph/graph.module';
import { SearchSettingsModule } from '@modules/search-settings/search-settings.module';
import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';
import { WsNotifyModule } from '@modules/ws-notify/ws-notify.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdCampaignModel, AdCampaignSchema } from '@schemas/ad-campaign.schema';
import {
  AdsTargetingAuditLogModel,
  AdsTargetingAuditLogSchema,
} from '@schemas/ads-targeting-audit-log.schema';
import {
  AdsTargetingEventModel,
  AdsTargetingEventSchema,
} from '@schemas/ads-targeting-event.schema';
import {
  AdsTargetingProfileModel,
  AdsTargetingProfileSchema,
} from '@schemas/ads-targeting-profile.schema';
import { AdsTargetingController } from './ads-targeting.controller';
import { AdsTargetingService } from './ads-targeting.service';

@Module({
  imports: [
    AdsModule,
    SubscriptionsModule,
    SearchSettingsModule,
    WsNotifyModule,
    GraphModule,
    MongooseModule.forFeature([
      { name: AdsTargetingEventModel.name, schema: AdsTargetingEventSchema },
      {
        name: AdsTargetingProfileModel.name,
        schema: AdsTargetingProfileSchema,
      },
      {
        name: AdsTargetingAuditLogModel.name,
        schema: AdsTargetingAuditLogSchema,
      },
      { name: AdCampaignModel.name, schema: AdCampaignSchema },
    ]),
  ],
  controllers: [AdsTargetingController],
  providers: [AdsTargetingService],
  exports: [AdsTargetingService],
})
export class AdsTargetingModule {}
