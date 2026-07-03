import { Module } from '@nestjs/common';
import { FoodNewsletterModule } from '@modules/food-newsletter/food-newsletter.module';
import { PushRecommendationsModule } from '@modules/push-recommendations/push-recommendations.module';
import { EngagementAutomationAdminController } from './engagement-automation-admin.controller';
import { EngagementAutomationAdminService } from './engagement-automation-admin.service';

@Module({
  imports: [PushRecommendationsModule, FoodNewsletterModule],
  controllers: [EngagementAutomationAdminController],
  providers: [EngagementAutomationAdminService],
})
export class EngagementAutomationAdminModule {}
