import { IsOptional, IsString } from 'class-validator';

export class QueryEngagementPerformancesDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  candidateType?: string;

  @IsOptional()
  @IsString()
  copySource?: string;
}
