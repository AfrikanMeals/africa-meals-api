import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { RecommendationsModule } from '@modules/recommendations/recommendations.module';
import { RecommendationAutomationSettingsModule } from '@modules/recommendation-automation-settings/recommendation-automation-settings.module';
import { EngagementPerformancesModule } from '@modules/engagement-performances/engagement-performances.module';
import { GraphModule } from '@modules/graph/graph.module';
import {
  PushRecommendationCandidateModel,
  PushRecommendationCandidateSchema,
} from '@schemas/push-recommendation-candidate.schema';
import {
  PushDeliveryScheduleModel,
  PushDeliveryScheduleSchema,
} from '@schemas/push-delivery-schedule.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { PushRecommendationClassifierService } from './push-recommendation-classifier.service';
import { PushRecommendationCopyService } from './push-recommendation-copy.service';
import { PushRecommendationPlannerService } from './push-recommendation-planner.service';
import { PushRecommendationDeliveryService } from './push-recommendation-delivery.service';
import { PushRecommendationClassifierCron } from './push-recommendation-classifier.cron';
import { PushRecommendationPlannerCron } from './push-recommendation-planner.cron';
import { PushRecommendationsController } from './push-recommendations.controller';
import { PushRecommendationsTrackingService } from './push-recommendations-tracking.service';

@Module({
  imports: [
    RecommendationsModule,
    RecommendationAutomationSettingsModule,
    EngagementPerformancesModule,
    NotificationsModule,
    GraphModule,
    MongooseModule.forFeature([
      {
        name: PushRecommendationCandidateModel.name,
        schema: PushRecommendationCandidateSchema,
      },
      {
        name: PushDeliveryScheduleModel.name,
        schema: PushDeliveryScheduleSchema,
      },
      { name: UserModel.name, schema: UserSchema },
    ]),
  ],
  controllers: [PushRecommendationsController],
  providers: [
    PushRecommendationClassifierService,
    PushRecommendationCopyService,
    PushRecommendationPlannerService,
    PushRecommendationDeliveryService,
    PushRecommendationClassifierCron,
    PushRecommendationPlannerCron,
    PushRecommendationsTrackingService,
  ],
  exports: [
    PushRecommendationClassifierService,
    PushRecommendationPlannerService,
    PushRecommendationsTrackingService,
  ],
})
export class PushRecommendationsModule {}
