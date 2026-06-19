import { MailerModule } from '@modules/mailer/mailer.module';
import { SmsModule } from '@modules/messaging/sms.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  VendorNotificationDeliveryModel,
  VendorNotificationDeliverySchema,
} from '@schemas/vendor-notification-delivery.schema';
import {
  VendorNotificationMonthlyChargeModel,
  VendorNotificationMonthlyChargeSchema,
} from '@schemas/vendor-notification-monthly-charge.schema';
import {
  VendorNotificationPreferencesModel,
  VendorNotificationPreferencesSchema,
} from '@schemas/vendor-notification-preferences.schema';
import {
  VendorNotificationPricingSettingsModel,
  VendorNotificationPricingSettingsSchema,
} from '@schemas/vendor-notification-pricing-settings.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { VendorNotificationAdminController } from './vendor-notification-admin.controller';
import { VendorNotificationAdminService } from './vendor-notification-admin.service';
import { VendorNotificationBillingCron } from './vendor-notification-billing.cron';
import { VendorNotificationBillingService } from './vendor-notification-billing.service';
import { VendorNotificationController } from './vendor-notification.controller';
import { VendorNotificationDispatchService } from './vendor-notification-dispatch.service';
import { VendorNotificationPreferencesService } from './vendor-notification-preferences.service';
import { VendorNotificationStripeBillingService } from './vendor-notification-stripe-billing.service';

@Module({
  imports: [
    MailerModule,
    SmsModule,
    NotificationsModule,
    forwardRef(() => TeamsModule),
    MongooseModule.forFeature([
      {
        name: VendorNotificationPreferencesModel.name,
        schema: VendorNotificationPreferencesSchema,
      },
      {
        name: VendorNotificationDeliveryModel.name,
        schema: VendorNotificationDeliverySchema,
      },
      {
        name: VendorNotificationPricingSettingsModel.name,
        schema: VendorNotificationPricingSettingsSchema,
      },
      {
        name: VendorNotificationMonthlyChargeModel.name,
        schema: VendorNotificationMonthlyChargeSchema,
      },
      { name: StoreModel.name, schema: StoreSchema },
      { name: UserModel.name, schema: UserSchema },
    ]),
  ],
  controllers: [VendorNotificationController, VendorNotificationAdminController],
  providers: [
    VendorNotificationPreferencesService,
    VendorNotificationDispatchService,
    VendorNotificationBillingService,
    VendorNotificationAdminService,
    VendorNotificationStripeBillingService,
    VendorNotificationBillingCron,
  ],
  exports: [
    VendorNotificationPreferencesService,
    VendorNotificationDispatchService,
    VendorNotificationBillingService,
    VendorNotificationAdminService,
    VendorNotificationStripeBillingService,
  ],
})
export class VendorNotificationModule {}
