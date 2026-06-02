import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  AdminOpsReportSettingsModel,
  AdminOpsReportSettingsSchema,
} from '@schemas/admin-ops-report-settings.schema';
import { AdCampaignEventModel, AdCampaignEventSchema } from '@schemas/ad-campaign-event.schema';
import { AdEventModel, AdEventSchema } from '@schemas/ad-event.schema';
import {
  AdNotificationEventModel,
  AdNotificationEventSchema,
} from '@schemas/ad-notification-event.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { DashboardModule } from '@modules/dashboard/dashboard.module';
import { DbMaintenanceModule } from '@modules/db-maintenance/db-maintenance.module';
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
    DbMaintenanceModule,
    MongooseModule.forFeature([
      {
        name: AdminOpsReportSettingsModel.name,
        schema: AdminOpsReportSettingsSchema,
      },
      { name: UserModel.name, schema: UserSchema },
      { name: OrderModel.name, schema: OrderSchema },
      { name: AdEventModel.name, schema: AdEventSchema },
      { name: AdCampaignEventModel.name, schema: AdCampaignEventSchema },
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
