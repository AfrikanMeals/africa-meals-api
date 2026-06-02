import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AdminOpsReportSettingsModel,
  AdminOpsReportSettingsSchema,
} from '@schemas/admin-ops-report-settings.schema';
import { AdModel, AdSchema } from '@schemas/ad.schema';
import { AdCampaignEventModel, AdCampaignEventSchema } from '@schemas/ad-campaign-event.schema';
import { AdCampaignModel, AdCampaignSchema } from '@schemas/ad-campaign.schema';
import { AdEventModel, AdEventSchema } from '@schemas/ad-event.schema';
import {
  AdNotificationEventModel,
  AdNotificationEventSchema,
} from '@schemas/ad-notification-event.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import {
  VendorOpsReportDeliveryModel,
  VendorOpsReportDeliverySchema,
} from '@schemas/vendor-ops-report-delivery.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { DashboardModule } from '@modules/dashboard/dashboard.module';
import { MailerModule } from '@modules/mailer/mailer.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { AdminOpsReportBuilderService } from './admin-ops-report-builder.service';
import { AdminOpsReportsAdminController } from './admin-ops-reports-admin.controller';
import { AdminOpsReportsCron } from './admin-ops-reports.cron';
import { AdminOpsReportsService } from './admin-ops-reports.service';

@Module({
  imports: [
    TeamsModule,
    MailerModule,
    DashboardModule,
    MongooseModule.forFeature([
      {
        name: AdminOpsReportSettingsModel.name,
        schema: AdminOpsReportSettingsSchema,
      },
      { name: UserModel.name, schema: UserSchema },
      { name: StoreModel.name, schema: StoreSchema },
      { name: AdModel.name, schema: AdSchema },
      { name: AdCampaignModel.name, schema: AdCampaignSchema },
      { name: AdEventModel.name, schema: AdEventSchema },
      { name: AdCampaignEventModel.name, schema: AdCampaignEventSchema },
      {
        name: VendorOpsReportDeliveryModel.name,
        schema: VendorOpsReportDeliverySchema,
      },
      {
        name: AdNotificationEventModel.name,
        schema: AdNotificationEventSchema,
      },
    ]),
  ],
  controllers: [AdminOpsReportsAdminController],
  providers: [
    AdminOpsReportsService,
    AdminOpsReportBuilderService,
    AdminOpsReportsCron,
  ],
})
export class AdminOpsReportsModule {}
