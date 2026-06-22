import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class PlanRegionPricingDto {
  @IsString()
  regionCode: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceMonthly: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceYearly: number;

  @IsOptional()
  @IsString()
  currency?: string;
}

export function normalizePlanRegionPricing(
  rows: PlanRegionPricingDto[] | undefined,
): PlanRegionPricingDto[] {
  if (!rows?.length) return [];
  const out: PlanRegionPricingDto[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const regionCode = String(row.regionCode ?? '')
      .trim()
      .toUpperCase();
    if (!regionCode || seen.has(regionCode)) continue;
    seen.add(regionCode);
    out.push({
      regionCode,
      priceMonthly: Math.max(0, Number(row.priceMonthly ?? 0)),
      priceYearly: Math.max(0, Number(row.priceYearly ?? 0)),
      currency: String(row.currency ?? 'CAD')
        .trim()
        .toUpperCase() || 'CAD',
    });
  }
  return out;
}
