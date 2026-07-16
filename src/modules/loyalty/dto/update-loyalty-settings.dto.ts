import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class LoyaltyTierSettingDto {
  @IsString()
  name: string;

  @IsInt()
  @Min(0)
  min: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  max?: number | null;
}

export class LoyaltyRewardSettingDto {
  @IsString()
  id: string;

  @IsString()
  @MaxLength(120)
  title: string;

  @IsString()
  @MaxLength(8)
  icon: string;

  @IsInt()
  @Min(0)
  @Max(100_000)
  points: number;

  @IsString()
  @MaxLength(32)
  category: string;

  @Transform(({ value }) => {
    if (value === true || value === 'true' || value === 1 || value === '1') {
      return true;
    }
    if (value === false || value === 'false' || value === 0 || value === '0') {
      return false;
    }
    return value;
  })
  @IsBoolean()
  active: boolean;
}

export class UpdateLoyaltySettingsDto {
  // Devise ISO 4217 (ex. CAD, XAF, EUR) ; si absent, garde la valeur courante.
  @IsOptional()
  @IsString()
  @MaxLength(5)
  currency?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  inactiveDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  cadPerPoint?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000)
  welcomeBonusPoints?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoyaltyTierSettingDto)
  tiers?: LoyaltyTierSettingDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LoyaltyRewardSettingDto)
  rewards?: LoyaltyRewardSettingDto[];
}
