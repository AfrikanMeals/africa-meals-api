import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MailerModule } from '@modules/mailer/mailer.module';
import { RecommendationsModule } from '@modules/recommendations/recommendations.module';
import { NewsletterAutomationSettingsModule } from '@modules/newsletter-automation-settings/newsletter-automation-settings.module';
import { EngagementPerformancesModule } from '@modules/engagement-performances/engagement-performances.module';
import { UserNotificationPreferencesModule } from '@modules/user-notification-preferences/user-notification-preferences.module';
import {
  FoodNewsletterCandidateModel,
  FoodNewsletterCandidateSchema,
} from '@schemas/food-newsletter-candidate.schema';
import {
  FoodNewsletterScheduleModel,
  FoodNewsletterScheduleSchema,
} from '@schemas/food-newsletter-schedule.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import { StoreSubscriberModel, StoreSubscriberSchema } from '@schemas/store-subscriber.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { FoodNewsletterClassifierService } from './food-newsletter-classifier.service';
import { FoodNewsletterCopyService } from './food-newsletter-copy.service';
import { FoodNewsletterPlannerService } from './food-newsletter-planner.service';
import { FoodNewsletterDeliveryService } from './food-newsletter-delivery.service';
import { FoodNewsletterClassifierCron } from './food-newsletter-classifier.cron';
import { FoodNewsletterPlannerCron } from './food-newsletter-planner.cron';
import { FoodNewsletterController } from './food-newsletter.controller';
import { FoodNewsletterTrackingService } from './food-newsletter-tracking.service';

@Module({
  imports: [
    RecommendationsModule,
    NewsletterAutomationSettingsModule,
    EngagementPerformancesModule,
    UserNotificationPreferencesModule,
    MailerModule,
    MongooseModule.forFeature([
      {
        name: FoodNewsletterCandidateModel.name,
        schema: FoodNewsletterCandidateSchema,
      },
      {
        name: FoodNewsletterScheduleModel.name,
        schema: FoodNewsletterScheduleSchema,
      },
      { name: UserModel.name, schema: UserSchema },
      { name: StoreSubscriberModel.name, schema: StoreSubscriberSchema },
      { name: StoreModel.name, schema: StoreSchema },
      { name: ProductModel.name, schema: ProductSchema },
    ]),
  ],
  controllers: [FoodNewsletterController],
  providers: [
    FoodNewsletterClassifierService,
    FoodNewsletterCopyService,
    FoodNewsletterPlannerService,
    FoodNewsletterDeliveryService,
    FoodNewsletterClassifierCron,
    FoodNewsletterPlannerCron,
    FoodNewsletterTrackingService,
  ],
  exports: [
    FoodNewsletterClassifierService,
    FoodNewsletterPlannerService,
    FoodNewsletterTrackingService,
  ],
})
export class FoodNewsletterModule {}
