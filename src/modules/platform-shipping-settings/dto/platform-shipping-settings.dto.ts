import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
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

  @ApiProperty({ example: 5, description: 'Borne max (km), exclue [minKm, maxKm)' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxKm: number;

  @ApiProperty({ example: 3.99, description: 'Forfait (devise plateforme) pour cette tranche' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fee: number;
}

export class UpdatePlatformShippingSettingsDto {
  @ApiProperty({
    example: 0.85,
    description: 'Tarif par km ajouté au forfait de tranche : total ≈ fee_tranche + distance × perKmRate',
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
}
