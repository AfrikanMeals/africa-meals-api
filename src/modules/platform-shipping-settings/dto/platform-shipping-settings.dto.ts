import { PLATFORM_FEE_MODES } from '@schemas/platform-shipping-settings.schema';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
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
}
