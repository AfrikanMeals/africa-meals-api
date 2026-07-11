import { Type } from 'class-transformer';
import { IsNumber, IsOptional, Min } from 'class-validator';

/** Sync quotidien perf livreur (mobile → snapshot Mongo). */
export class SyncDeliveryAgentDailyPerformanceDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  ordersShippedToday?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  distanceKmToday?: number;
}
