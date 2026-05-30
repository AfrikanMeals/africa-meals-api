import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  SubscriptionPlanModel,
  SubscriptionPlanSchema,
} from '@schemas/subscription-plan.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import {
  VendorSubscriptionModel,
  VendorSubscriptionSchema,
} from '@schemas/vendor-subscription.schema';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionLifecycleCron } from './subscription-lifecycle.cron';
import { SubscriptionTrialReminderCron } from './subscription-trial-reminder.cron';
import { SubscriptionTrialReminderService } from './subscription-trial-reminder.service';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsStripeCheckoutService } from './subscriptions-stripe-checkout.service';

@Module({
  imports: [
    NotificationsModule,
    MongooseModule.forFeature([
      { name: SubscriptionPlanModel.name, schema: SubscriptionPlanSchema },
      {
        name: VendorSubscriptionModel.name,
        schema: VendorSubscriptionSchema,
      },
      { name: StoreModel.name, schema: StoreSchema },
    ]),
  ],
  controllers: [SubscriptionsController],
  providers: [
    SubscriptionsService,
    SubscriptionsStripeCheckoutService,
    SubscriptionLifecycleCron,
    SubscriptionTrialReminderService,
    SubscriptionTrialReminderCron,
  ],
  exports: [SubscriptionsService, SubscriptionsStripeCheckoutService],
})
export class SubscriptionsModule {}
