import { Type } from 'class-transformer';
import { IsDateString, IsMongoId, IsOptional, Max, Min } from 'class-validator';

export class QueryVendorAnalyticsDto {
  @IsOptional()
  @IsMongoId()
  storeId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  @Max(365)
  rangeDays?: number;
}
