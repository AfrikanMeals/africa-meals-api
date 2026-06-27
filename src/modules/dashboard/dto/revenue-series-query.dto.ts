import { IsIn, IsOptional, Matches } from 'class-validator';

export type DashboardRevenueSeriesPeriod = '7d' | '30d' | '12m';

export class DashboardRevenueSeriesQueryDto {
  @IsOptional()
  @IsIn(['7d', '30d', '12m'])
  period?: DashboardRevenueSeriesPeriod;

  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/)
  region?: string;
}

export function parseRevenueSeriesPeriod(
  raw?: string,
): DashboardRevenueSeriesPeriod {
  if (raw === '30d' || raw === '12m') return raw;
  return '7d';
}
