import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  RecommendationAutomationSettingsModel,
  RecommendationAutomationSettingsSchema,
} from '@schemas/recommendation-automation-settings.schema';
import { RecommendationAutomationSettingsController } from './recommendation-automation-settings.controller';
import { RecommendationAutomationSettingsService } from './recommendation-automation-settings.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: RecommendationAutomationSettingsModel.name,
        schema: RecommendationAutomationSettingsSchema,
      },
    ]),
  ],
  controllers: [RecommendationAutomationSettingsController],
  providers: [RecommendationAutomationSettingsService],
  exports: [RecommendationAutomationSettingsService],
})
export class RecommendationAutomationSettingsModule {}
