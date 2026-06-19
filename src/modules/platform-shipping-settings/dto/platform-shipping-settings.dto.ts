import { PLATFORM_FEE_MODES } from '@schemas/platform-shipping-settings.schema';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Trim } from 'class-sanitizer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class PlatformShippingRangeDto {
  @ApiProperty({ example: 0, description: 'Borne min (km), incluse' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minKm: number;

  @ApiProperty({
    example: 5,
    description: 'Borne max (km), exclue [minKm, maxKm)',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxKm: number;

  @ApiProperty({
    example: 2.5,
    description:
      'Prix de base pour cette tranche (remplace le prix de base global lorsque la distance tombe dans [minKm, maxKm))',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  basePrice?: number;

  @ApiProperty({
    example: 3.99,
    description: 'Forfait (devise plateforme) pour cette tranche',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fee: number;
}

export class UpdatePlatformShippingSettingsDto {
  @ApiProperty({
    example: 0.85,
    description:
      'Tarif par km : frais livraison plateforme = distance (km) × perKmRate, dans maxDeliveryRadiusKm',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  perKmRate: number;

  @ApiProperty({
    example: 3.5,
    description:
      'Forfait de base ajouté aux frais livraison (en plus de distance × perKmRate)',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deliveryBasePrice: number;

  @ApiProperty({
    example: 'CAD',
    description: 'Devise des montants livraison (régions actives)',
  })
  @IsString()
  @Trim()
  @Length(3, 3)
  @Matches(/^[A-Z]{3}$/i)
  currency: string;

  @ApiProperty({
    example: 20,
    description: 'Rayon maximal de livraison (km) depuis le restaurant',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(500)
  maxDeliveryRadiusKm: number;

  @ApiProperty({ type: [PlatformShippingRangeDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlatformShippingRangeDto)
  ranges: PlatformShippingRangeDto[];

  @ApiPropertyOptional({
    enum: PLATFORM_FEE_MODES,
    description: 'Mode des frais prélevés sur la livraison',
  })
  @IsOptional()
  @IsIn(PLATFORM_FEE_MODES)
  deliveryWithheldFeeMode?: (typeof PLATFORM_FEE_MODES)[number];

  @ApiPropertyOptional({
    example: 1.5,
    description: 'Frais fixe prélevé sur chaque livraison ($)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deliveryWithheldFeeFixed?: number;

  @ApiPropertyOptional({
    example: 15,
    description: '% du frais de livraison facturé au client',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  deliveryWithheldFeePercent?: number;

  @ApiPropertyOptional({
    description: 'Proposer un pourboire livreur au client',
  })
  @IsOptional()
  @IsBoolean()
  deliveryTipEnabled?: boolean;

  @ApiPropertyOptional({
    enum: PLATFORM_FEE_MODES,
    description: 'Mode du pourboire suggéré (montant fixe ou % commande)',
  })
  @IsOptional()
  @IsIn(PLATFORM_FEE_MODES)
  deliveryTipMode?: (typeof PLATFORM_FEE_MODES)[number];

  @ApiPropertyOptional({
    example: 3,
    description: 'Montant fixe de pourboire suggéré ($)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  deliveryTipFixed?: number;

  @ApiPropertyOptional({
    example: 10,
    description: '% de la valeur commande pour le pourboire suggéré',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  deliveryTipPercent?: number;

  @ApiPropertyOptional({
    type: [Number],
    example: [2, 3, 5],
    description:
      'Options de pourboire proposées ($ ou % selon deliveryTipMode). Au moins une si deliveryTipEnabled.',
  })
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsNumber({}, { each: true })
  @Min(0, { each: true })
  deliveryTipPresets?: number[];

  @ApiPropertyOptional({
    type: [Number],
    example: [2, 3, 5],
    description: 'Options montant fixe ($).',
  })
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsNumber({}, { each: true })
  @Min(0, { each: true })
  deliveryTipFixedPresets?: number[];

  @ApiPropertyOptional({
    type: [Number],
    example: [5, 10, 15],
    description: 'Options pourcentage (% sous-total livraison).',
  })
  @IsOptional()
  @IsArray()
  @Type(() => Number)
  @IsNumber({}, { each: true })
  @Min(0, { each: true })
  @Max(100, { each: true })
  deliveryTipPercentPresets?: number[];

  @ApiPropertyOptional({
    example: 'CM',
    description:
      'Région active (ISO2) — enregistre tous les paramètres dans settingsByRegion.',
  })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/i)
  regionCode?: string;

  @ApiPropertyOptional({
    example: 'CM',
    description: 'Alias legacy de regionCode (pourboires).',
  })
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Z]{2}$/i)
  deliveryTipRegionCode?: string;
}
