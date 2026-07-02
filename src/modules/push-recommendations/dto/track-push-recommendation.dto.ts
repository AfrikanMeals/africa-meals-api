import { IsEnum, IsMongoId, IsOptional, IsString } from 'class-validator';
import { EngagementPerformanceEventType } from '@schemas/engagement-performance-event.schema';

export class TrackPushRecommendationDto {
  @IsEnum([
    EngagementPerformanceEventType.OPEN,
    EngagementPerformanceEventType.CLICK,
    EngagementPerformanceEventType.DISMISS,
    EngagementPerformanceEventType.UNSUBSCRIBE,
  ])
  event:
    | EngagementPerformanceEventType.OPEN
    | EngagementPerformanceEventType.CLICK
    | EngagementPerformanceEventType.DISMISS
    | EngagementPerformanceEventType.UNSUBSCRIBE;

  @IsOptional()
  @IsString()
  scheduleId?: string;

  @IsOptional()
  @IsString()
  campaignId?: string;

  @IsOptional()
  @IsString()
  candidateType?: string;

  @IsOptional()
  @IsString()
  refType?: string;

  @IsOptional()
  @IsMongoId()
  refId?: string;
}
