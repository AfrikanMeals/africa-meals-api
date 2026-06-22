import { PLATFORM_FEE_MODES } from '@schemas/platform-fees-settings.schema';
import {
  IsIn,
  IsNumber,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class PlanRegionOrderCommissionDto {
  @IsString()
  @MinLength(2)
  regionCode: string;

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
    const mode = row.mode === 'fixed' ? 'fixed' : 'percent';
    const fixed = Math.max(0, Number(row.fixed ?? 0));
    const percent = Math.max(0, Number(row.percent ?? 0));
    if (mode === 'fixed' && fixed <= 0) continue;
    if (mode === 'percent' && percent <= 0) continue;
    seen.add(regionCode);
    out.push({
      regionCode,
      mode,
      fixed: mode === 'fixed' ? fixed : 0,
      percent: mode === 'percent' ? percent : 0,
    });
  }
  return out;
}
