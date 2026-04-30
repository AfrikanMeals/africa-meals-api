import { StoreAdActionTypeEnum } from '@schemas/ad.schema';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateAdManagementDto {
  @ApiPropertyOptional({
    description:
      'ID boutique. Omis ou vide = bannière globale (admin uniquement).',
  })
  @IsOptional()
  @IsMongoId()
  storeId?: string;

  @ApiProperty({ example: 'Livraison gratuite' })
  @IsString()
  @MaxLength(120)
  title: string;

  @ApiProperty({ example: 'Sur les commandes de plus de 25 $ cette semaine' })
  @IsString()
  @MaxLength(300)
  subtitle: string;

  @ApiProperty({ example: 'Commander' })
  @IsString()
  @MaxLength(80)
  actionText: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ example: '2026-01-01T00:00:00.000Z' })
  @IsDateString()
  validFrom: string;

  @ApiProperty({ example: '2026-12-31T23:59:59.999Z' })
  @IsDateString()
  validUntil: string;

  @ApiProperty({ enum: StoreAdActionTypeEnum })
  @IsEnum(StoreAdActionTypeEnum)
  actionType: StoreAdActionTypeEnum;

  @ApiPropertyOptional({ description: 'Obligatoire si actionType = PRODUCT' })
  @ValidateIf((o) => o.actionType === StoreAdActionTypeEnum.PRODUCT)
  @IsNotEmpty()
  @IsMongoId()
  productId?: string;
}

export class PatchAdManagementDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  subtitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  actionText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  imageUrl?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @ApiPropertyOptional({ enum: StoreAdActionTypeEnum })
  @IsOptional()
  @IsEnum(StoreAdActionTypeEnum)
  actionType?: StoreAdActionTypeEnum;

  @ApiPropertyOptional()
  @ValidateIf((o) => o.actionType === StoreAdActionTypeEnum.PRODUCT)
  @IsOptional()
  @IsMongoId()
  productId?: string | null;
}

/** Bannière pub : JSON + base64 — fiable quand multipart est tronqué (Firebase / CF / proxys). */
export class AdBannerImageJsonDto {
  @ApiProperty({
    description: 'Image en base64 (pur ou préfixe data:image/...;base64,)',
  })
  @IsNotEmpty()
  @IsString()
  imageBase64: string;

  @ApiPropertyOptional({ example: 'banniere.webp' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  filename?: string;
}
