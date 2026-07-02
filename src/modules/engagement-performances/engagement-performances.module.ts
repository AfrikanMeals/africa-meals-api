import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  EngagementPerformanceEventModel,
  EngagementPerformanceEventSchema,
} from '@schemas/engagement-performance-event.schema';
import {
  EngagementPerformanceDailyModel,
  EngagementPerformanceDailySchema,
} from '@schemas/engagement-performance-daily.schema';
import { EngagementPerformancesController } from './engagement-performances.controller';
import { EngagementPerformancesService } from './engagement-performances.service';
import { EngagementPerformancesAggregationCron } from './engagement-performances-aggregation.cron';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: EngagementPerformanceEventModel.name,
        schema: EngagementPerformanceEventSchema,
      },
      {
        name: EngagementPerformanceDailyModel.name,
        schema: EngagementPerformanceDailySchema,
      },
    ]),
  ],
  controllers: [EngagementPerformancesController],
  providers: [EngagementPerformancesService, EngagementPerformancesAggregationCron],
  exports: [EngagementPerformancesService],
})
export class EngagementPerformancesModule {}
