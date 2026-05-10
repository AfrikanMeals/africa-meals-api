import { StoreCouponDiscountTypeEnum } from '@schemas/store_coupon.schema';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsMongoId,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateStoreCouponDto {
  @ApiProperty({ example: 'SUMMER10' })
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'code_invalid_chars',
  })
  code: string;

  @ApiProperty({ description: 'ID boutique Mongo' })
  @IsMongoId()
  storeId: string;

  @ApiProperty({ enum: StoreCouponDiscountTypeEnum })
  @IsEnum(StoreCouponDiscountTypeEnum)
  discountType: StoreCouponDiscountTypeEnum;

  @ApiProperty({
    description: 'Montant devise si FIXED, ou pourcentage 1–100 si PERCENTAGE',
    example: 10,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  value: number;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  @IsDateString()
  validFrom: string;

  @ApiProperty({ example: '2026-12-31T23:59:59.999Z' })
  @IsDateString()
  validUntil: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Nombre max d’utilisations (optionnel)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1_000_000)
  maxUses?: number;
}

export class PatchStoreCouponDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9_-]+$/)
  code?: string;

  @ApiPropertyOptional({ enum: StoreCouponDiscountTypeEnum })
  @IsOptional()
  @IsEnum(StoreCouponDiscountTypeEnum)
  discountType?: StoreCouponDiscountTypeEnum;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  value?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1_000_000)
  maxUses?: number | null;
}
