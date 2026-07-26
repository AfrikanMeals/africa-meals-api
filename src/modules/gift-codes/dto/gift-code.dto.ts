import {
  GiftCodeDiscountTypeEnum,
  GiftCodeFeeCoverageEnum,
  GiftCodePromoTypeEnum,
  GiftCodeScopeTypeEnum,
} from '@schemas/gift_code.schema';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
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
  ValidateIf,
} from 'class-validator';

export class CreateGiftCodeDto {
  @ApiProperty({ example: 'NOEL2026' })
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'code_invalid_chars' })
  code: string;

  @ApiProperty({ enum: GiftCodeScopeTypeEnum, default: GiftCodeScopeTypeEnum.ALL })
  @IsEnum(GiftCodeScopeTypeEnum)
  scopeType: GiftCodeScopeTypeEnum;

  @ApiPropertyOptional({
    description: 'IDs boutiques (requis si scopeType = specific)',
    type: [String],
  })
  @ValidateIf((o: CreateGiftCodeDto) => o.scopeType === GiftCodeScopeTypeEnum.SPECIFIC)
  @IsArray()
  @IsMongoId({ each: true })
  storeIds?: string[];

  @ApiPropertyOptional({
    description: 'Codes région ISO2 (requis si scopeType = region)',
    type: [String],
  })
  @ValidateIf((o: CreateGiftCodeDto) => o.scopeType === GiftCodeScopeTypeEnum.REGION)
  @IsArray()
  @IsString({ each: true })
  @Matches(/^[A-Za-z]{2}$/, { each: true, message: 'invalid_region_code' })
  regionCodes?: string[];

  @ApiProperty({ enum: GiftCodeDiscountTypeEnum })
  @IsEnum(GiftCodeDiscountTypeEnum)
  discountType: GiftCodeDiscountTypeEnum;

  @ApiPropertyOptional({
    enum: GiftCodePromoTypeEnum,
    default: GiftCodePromoTypeEnum.DISCOUNT,
  })
  @IsOptional()
  @IsEnum(GiftCodePromoTypeEnum)
  promoType?: GiftCodePromoTypeEnum;

  @ApiPropertyOptional({
    enum: GiftCodeFeeCoverageEnum,
    default: GiftCodeFeeCoverageEnum.STORE,
    description:
      'STORE = boutique absorbe la remise ; PLATFORM = Wise Eat (vendeur pré-gift).',
  })
  @IsOptional()
  @IsEnum(GiftCodeFeeCoverageEnum)
  feeCoverage?: GiftCodeFeeCoverageEnum;

  @ApiPropertyOptional({ example: 'Meilleure offre : 20 % de réduction' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional({
    example: 'Promo fin d\'année, valable sur les boutiques éligibles.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  subtitle?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/promo.jpg' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imageUrl?: string;

  @ApiProperty({ example: 10 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  value: number;

  @ApiPropertyOptional({
    default: 0,
    description:
      'Sous-total éligible minimum (major units) pour valider le gift. 0 = aucun seuil.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(999_999)
  minCartAmount?: number;

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

  @ApiPropertyOptional({ description: "Limite globale d'utilisations" })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(10_000_000)
  maxUses?: number;

  @ApiPropertyOptional({ description: 'Limite par utilisateur' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1_000)
  maxUsesPerUser?: number;
}

export class PatchGiftCodeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: 'code_invalid_chars' })
  code?: string;

  @ApiPropertyOptional({ enum: GiftCodeScopeTypeEnum })
  @IsOptional()
  @IsEnum(GiftCodeScopeTypeEnum)
  scopeType?: GiftCodeScopeTypeEnum;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  storeIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Matches(/^[A-Za-z]{2}$/, { each: true, message: 'invalid_region_code' })
  regionCodes?: string[];

  @ApiPropertyOptional({ enum: GiftCodeDiscountTypeEnum })
  @IsOptional()
  @IsEnum(GiftCodeDiscountTypeEnum)
  discountType?: GiftCodeDiscountTypeEnum;

  @ApiPropertyOptional({ enum: GiftCodePromoTypeEnum })
  @IsOptional()
  @IsEnum(GiftCodePromoTypeEnum)
  promoType?: GiftCodePromoTypeEnum;

  @ApiPropertyOptional({ enum: GiftCodeFeeCoverageEnum })
  @IsOptional()
  @IsEnum(GiftCodeFeeCoverageEnum)
  feeCoverage?: GiftCodeFeeCoverageEnum;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(280)
  subtitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imageUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.0001)
  value?: number;

  @ApiPropertyOptional({
    description:
      'Sous-total éligible minimum (major units). 0 = aucun seuil.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(999_999)
  minCartAmount?: number;

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
  @Max(10_000_000)
  maxUses?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(1_000)
  maxUsesPerUser?: number | null;
}
