import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

function toInt(v: unknown, fallback: number): number {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

export class VendorCatalogProductsQueryDto {
  @IsOptional()
  @Transform(({ value }) => Math.max(1, toInt(value, 1)))
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => Math.min(80, Math.max(8, toInt(value, 20))))
  take?: number = 20;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsIn(['food', 'daily_menu'])
  tab?: 'food' | 'daily_menu' = 'food';
}

export class VendorCatalogDrinksQueryDto {
  @IsOptional()
  @Transform(({ value }) => Math.max(1, toInt(value, 1)))
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => Math.min(80, Math.max(8, toInt(value, 20))))
  take?: number = 20;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}
