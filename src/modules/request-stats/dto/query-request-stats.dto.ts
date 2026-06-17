import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryRequestStatsDto {
  @IsOptional()
  @IsString()
  storeId?: string;

  @IsOptional()
  @IsIn(['http', 'ws', 'all'])
  kind?: 'http' | 'ws' | 'all';

  @IsOptional()
  @IsString()
  method?: string;

  @IsOptional()
  @IsString()
  routeContains?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600_000)
  minDurationMs?: number;

  @IsOptional()
  @IsIn(['at', 'duration'])
  sortBy?: 'at' | 'duration';
}
