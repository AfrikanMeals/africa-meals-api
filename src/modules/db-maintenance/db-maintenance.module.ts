import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdModel, AdSchema } from '@schemas/ad.schema';
import { AdCampaignModel, AdCampaignSchema } from '@schemas/ad-campaign.schema';
import {
  AdNotificationEventModel,
  AdNotificationEventSchema,
} from '@schemas/ad-notification-event.schema';
import {
  AdNotificationPricingSettingsModel,
  AdNotificationPricingSettingsSchema,
} from '@schemas/ad-notification-pricing-settings.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import {
  InfraRuntimeSettingsModel,
  InfraRuntimeSettingsSchema,
} from '@schemas/infra-runtime-settings.schema';
import {
  StripeProcessedCheckoutModel,
  StripeProcessedCheckoutSchema,
} from '@schemas/stripe-processed-checkout.schema';
import { DrinkModel, DrinkSchema } from '@schemas/drink.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import {
  StoreCouponModel,
  StoreCouponSchema,
} from '@schemas/store_coupon.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { MailerModule } from '../mailer/mailer.module';
import { SharedModule } from '../shared/shared.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TeamsModule } from '../teams/teams.module';
import { WsNotifyModule } from '../ws-notify/ws-notify.module';
import { AdminAlertEmailQueueService } from './admin-alert-email-queue.service';
import { AdminAlertEmailService } from './admin-alert-email.service';
import { DbMaintenanceAdminController } from './db-maintenance-admin.controller';
import { DbMaintenanceService } from './db-maintenance.service';

@Module({
  imports: [
    TeamsModule,
    SharedModule,
    SubscriptionsModule,
    WsNotifyModule,
    MailerModule,
    MongooseModule.forFeature([
      { name: UserModel.name, schema: UserSchema },
      { name: OrderModel.name, schema: OrderSchema },
      {
        name: StripeProcessedCheckoutModel.name,
        schema: StripeProcessedCheckoutSchema,
      },
      { name: StoreModel.name, schema: StoreSchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: DrinkModel.name, schema: DrinkSchema },
      { name: AdModel.name, schema: AdSchema },
      { name: AdCampaignModel.name, schema: AdCampaignSchema },
      {
        name: AdNotificationPricingSettingsModel.name,
        schema: AdNotificationPricingSettingsSchema,
      },
      {
        name: AdNotificationEventModel.name,
        schema: AdNotificationEventSchema,
      },
      { name: StoreCouponModel.name, schema: StoreCouponSchema },
      {
        name: InfraRuntimeSettingsModel.name,
        schema: InfraRuntimeSettingsSchema,
      },
    ]),
  ],
  controllers: [DbMaintenanceAdminController],
  providers: [
    DbMaintenanceService,
    AdminAlertEmailService,
    AdminAlertEmailQueueService,
  ],
  exports: [DbMaintenanceService],
})
export class DbMaintenanceModule {}
