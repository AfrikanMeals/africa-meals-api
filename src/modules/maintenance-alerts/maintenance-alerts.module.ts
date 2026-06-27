import { Module, forwardRef, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MaintenanceAlertSettingsModel,
  MaintenanceAlertSettingsSchema,
} from '@schemas/maintenance-alert-settings.schema';
import { DbMaintenanceModule } from '@modules/db-maintenance/db-maintenance.module';
import { MailerModule } from '@modules/mailer/mailer.module';
import { SmsModule } from '@modules/messaging/sms.module';
import { SseRedisModule } from '../../common/sse/sse-redis.module';
import { WsNotifyModule } from '@modules/ws-notify/ws-notify.module';
import { MaintenanceAlertMonitorService } from './maintenance-alert-monitor.service';
import { MaintenanceAlertNotifierService } from './maintenance-alert-notifier.service';
import { MaintenanceAlertSettingsService } from './maintenance-alert-settings.service';
import { MaintenanceAlertsAdminController } from './maintenance-alerts-admin.controller';
import { PlatformMaintenancePublicController } from './platform-maintenance-public.controller';
import { PlatformMaintenanceEmailService } from './platform-maintenance-email.service';
import { PlatformMaintenanceService } from './platform-maintenance.service';
import { PlatformMaintenanceSseService } from './platform-maintenance-sse.service';
import { PlatformMaintenanceMiddleware } from './platform-maintenance.middleware';

@Module({
  imports: [
    forwardRef(() => DbMaintenanceModule),
    MailerModule,
    SmsModule,
    SseRedisModule,
    WsNotifyModule,
    MongooseModule.forFeature([
      {
        name: MaintenanceAlertSettingsModel.name,
        schema: MaintenanceAlertSettingsSchema,
      },
    ]),
  ],
  controllers: [
    MaintenanceAlertsAdminController,
    PlatformMaintenancePublicController,
  ],
  providers: [
    MaintenanceAlertSettingsService,
    MaintenanceAlertNotifierService,
    MaintenanceAlertMonitorService,
    PlatformMaintenanceService,
    PlatformMaintenanceEmailService,
    PlatformMaintenanceSseService,
    PlatformMaintenanceMiddleware,
  ],
  exports: [
    MaintenanceAlertSettingsService,
    PlatformMaintenanceSseService,
    PlatformMaintenanceService,
  ],
})
export class MaintenanceAlertsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(PlatformMaintenanceMiddleware).forRoutes('*');
  }
}
