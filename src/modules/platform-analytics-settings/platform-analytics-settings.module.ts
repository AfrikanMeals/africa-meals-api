import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TeamsModule } from '@modules/teams/teams.module';
import {
  PlatformAnalyticsSettingsModel,
  PlatformAnalyticsSettingsSchema,
} from '@schemas/platform-analytics-settings.schema';
import { PlatformAnalyticsSettingsController } from './platform-analytics-settings.controller';
import { PlatformAnalyticsSettingsService } from './platform-analytics-settings.service';

@Module({
  imports: [
    TeamsModule,
    MongooseModule.forFeature([
      {
        name: PlatformAnalyticsSettingsModel.name,
        schema: PlatformAnalyticsSettingsSchema,
      },
    ]),
  ],
  controllers: [PlatformAnalyticsSettingsController],
  providers: [PlatformAnalyticsSettingsService],
  exports: [PlatformAnalyticsSettingsService],
})
export class PlatformAnalyticsSettingsModule {}
