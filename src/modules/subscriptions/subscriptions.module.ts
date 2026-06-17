import { MailerModule } from '@modules/mailer/mailer.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdModel, AdSchema } from '@schemas/ad.schema';
import { AdCampaignModel, AdCampaignSchema } from '@schemas/ad-campaign.schema';
import { DrinkModel, DrinkSchema } from '@schemas/drink.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import {
  SubscriptionPlanModel,
  SubscriptionPlanSchema,
} from '@schemas/subscription-plan.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import {
  VendorSubscriptionModel,
  VendorSubscriptionSchema,
} from '@schemas/vendor-subscription.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { PlatformSubscriptionPlansController } from './platform-subscription-plans.controller';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionLifecycleCron } from './subscription-lifecycle.cron';
import { SubscriptionTrialReminderCron } from './subscription-trial-reminder.cron';
import { SubscriptionTrialReminderService } from './subscription-trial-reminder.service';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsStripeCheckoutService } from './subscriptions-stripe-checkout.service';
import { VendorSubscriptionEmailService } from './vendor-subscription-email.service';

@Module({
  imports: [
    MailerModule,
    NotificationsModule,
    MongooseModule.forFeature([
      { name: UserModel.name, schema: UserSchema },
      { name: SubscriptionPlanModel.name, schema: SubscriptionPlanSchema },
      {
        name: VendorSubscriptionModel.name,
        schema: VendorSubscriptionSchema,
      },
      { name: StoreModel.name, schema: StoreSchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: DrinkModel.name, schema: DrinkSchema },
      { name: AdModel.name, schema: AdSchema },
      { name: AdCampaignModel.name, schema: AdCampaignSchema },
    ]),
  ],
  controllers: [SubscriptionsController, PlatformSubscriptionPlansController],
  providers: [
    SubscriptionsService,
    SubscriptionsStripeCheckoutService,
    VendorSubscriptionEmailService,
    SubscriptionLifecycleCron,
    SubscriptionTrialReminderService,
    SubscriptionTrialReminderCron,
  ],
  exports: [
    SubscriptionsService,
    SubscriptionsStripeCheckoutService,
    VendorSubscriptionEmailService,
    SubscriptionTrialReminderService,
  ],
})
export class SubscriptionsModule {}
