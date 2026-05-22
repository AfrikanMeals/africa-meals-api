import { IsIn, IsOptional } from 'class-validator';

export type DashboardRevenueSeriesPeriod = '7d' | '30d' | '12m';

export class DashboardRevenueSeriesQueryDto {
  @IsOptional()
  @IsIn(['7d', '30d', '12m'])
  period?: DashboardRevenueSeriesPeriod;
}

export function parseRevenueSeriesPeriod(
  raw?: string,
): DashboardRevenueSeriesPeriod {
  if (raw === '30d' || raw === '12m') return raw;
  return '7d';
}
