import { IsIn, IsOptional } from 'class-validator';
import type { GainEstimatePeriodKey } from '../gain-estimate.types';

export class GainEstimateQueryDto {
  @IsOptional()
  @IsIn(['7d', '30d', '90d'])
  period?: GainEstimatePeriodKey;

  @IsOptional()
  @IsIn(['fr', 'en'])
  locale?: 'fr' | 'en';
}
