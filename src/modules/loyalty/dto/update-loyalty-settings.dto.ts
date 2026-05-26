import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
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

export class UpdateLoyaltySettingsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  inactiveDays?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  fcfaPerPoint?: number;

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
}
