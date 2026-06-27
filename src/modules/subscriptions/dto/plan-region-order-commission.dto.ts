import { PLATFORM_FEE_MODES } from '@schemas/platform-fees-settings.schema';
import {
  COMMISSION_TIER_BASIS,
  CommissionTierBasis,
} from '@schemas/plan-region-order-commission-tier.schema';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PlanRegionOrderCommissionTierDto {
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  minPrice: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  maxPrice?: number;

  @IsIn(PLATFORM_FEE_MODES)
  mode: (typeof PLATFORM_FEE_MODES)[number];

  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  fixed: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  percent: number;
}

export class PlanRegionOrderCommissionDto {
  @IsString()
  @MinLength(2)
  regionCode: string;

  @IsOptional()
  @IsIn(COMMISSION_TIER_BASIS)
  tierBasis?: CommissionTierBasis;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanRegionOrderCommissionTierDto)
  tiers?: PlanRegionOrderCommissionTierDto[];

  @IsOptional()
  @IsIn(PLATFORM_FEE_MODES)
  fallbackMode?: (typeof PLATFORM_FEE_MODES)[number];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  fallbackFixed?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  fallbackPercent?: number;

  /** Legacy — ignoré si fallback* ou tiers fournis. */
  @IsOptional()
  @IsIn(PLATFORM_FEE_MODES)
  mode?: (typeof PLATFORM_FEE_MODES)[number];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  fixed?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  percent?: number;
}

function normalizeTierRow(
  row: PlanRegionOrderCommissionTierDto,
): PlanRegionOrderCommissionTierDto | null {
  const minPrice = Math.max(0, Number(row.minPrice ?? 0));
  const maxRaw = row.maxPrice;
  const maxPrice =
    maxRaw != null && Number(maxRaw) > 0 ? Math.max(0, Number(maxRaw)) : undefined;
  if (maxPrice != null && maxPrice <= minPrice) return null;
  const mode = row.mode === 'fixed' ? 'fixed' : 'percent';
  const fixed = Math.max(0, Number(row.fixed ?? 0));
  const percent = Math.max(0, Number(row.percent ?? 0));
  if (mode === 'fixed' && fixed <= 0) return null;
  if (mode === 'percent' && percent <= 0) return null;
  return {
    minPrice,
    maxPrice,
    mode,
    fixed: mode === 'fixed' ? fixed : 0,
    percent: mode === 'percent' ? percent : 0,
  };
}

export function normalizePlanRegionOrderCommissions(
  rows: PlanRegionOrderCommissionDto[] | undefined,
): PlanRegionOrderCommissionDto[] {
  if (!Array.isArray(rows)) return [];
  const out: PlanRegionOrderCommissionDto[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const regionCode = String(row.regionCode ?? '')
      .trim()
      .toUpperCase();
    if (regionCode.length < 2 || seen.has(regionCode)) continue;

    const legacyMode = row.mode === 'fixed' ? 'fixed' : 'percent';
    const legacyFixed = Math.max(0, Number(row.fixed ?? 0));
    const legacyPercent = Math.max(0, Number(row.percent ?? 0));

    const fallbackMode =
      row.fallbackMode === 'fixed' || row.fallbackMode === 'percent'
        ? row.fallbackMode
        : legacyMode;
    const fallbackFixed =
      row.fallbackFixed != null
        ? Math.max(0, Number(row.fallbackFixed))
        : legacyFixed;
    const fallbackPercent =
      row.fallbackPercent != null
        ? Math.max(0, Number(row.fallbackPercent))
        : legacyPercent;

    const tierBasis: CommissionTierBasis =
      row.tierBasis === 'order_subtotal' ? 'order_subtotal' : 'unit_price';

    const tiers = Array.isArray(row.tiers)
      ? row.tiers
          .map((t) => normalizeTierRow(t))
          .filter((t): t is PlanRegionOrderCommissionTierDto => t != null)
          .sort((a, b) => a.minPrice - b.minPrice)
      : [];

    const hasFallback =
      (fallbackMode === 'fixed' && fallbackFixed > 0) ||
      (fallbackMode === 'percent' && fallbackPercent > 0);

    if (!tiers.length && !hasFallback) continue;

    seen.add(regionCode);
    out.push({
      regionCode,
      tierBasis,
      tiers,
      fallbackMode,
      fallbackFixed: fallbackMode === 'fixed' ? fallbackFixed : 0,
      fallbackPercent: fallbackMode === 'percent' ? fallbackPercent : 0,
      mode: fallbackMode,
      fixed: fallbackMode === 'fixed' ? fallbackFixed : 0,
      percent: fallbackMode === 'percent' ? fallbackPercent : 0,
    });
  }
  return out;
}
