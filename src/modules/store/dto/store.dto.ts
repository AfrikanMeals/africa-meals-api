import { CreateAddressDto } from '@modules/addresses/dto/addresses.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class StoreShippingZoneDto {
  @ApiProperty({ description: 'Distance minimale (km)', example: 0, type: Number })
  @IsNotEmpty()
  @IsNumber()
  @Transform(({ value }) => +value)
  minDistance: number;

  @ApiProperty({ description: 'Distance maximale (km)', example: 10, type: Number })
  @IsNotEmpty()
  @IsNumber()
  @Transform(({ value }) => +value)
  maxDistance: number;

  @ApiProperty({ description: 'Prix de livraison (unité)', example: 5.99, type: Number })
  @IsNotEmpty()
  @IsNumber()
  @Transform(({ value }) => +value)
  price: number;
}

export class CreateStoreDto {
  @ApiProperty({ example: 'Le Bon Resto' })
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'Cuisine africaine traditionnelle' })
  @IsNotEmpty()
  bio: string;

  @ApiProperty({ format: 'email', example: 'contact@store.com' })
  @IsNotEmpty()
  email: string;

  @ApiProperty({ description: 'Livraison disponible', example: true, type: Boolean })
  @IsNotEmpty()
  @IsBoolean()
  supportsShipping: boolean;

  @ApiProperty({
    description: 'Téléphone international (validé selon le pays du restaurant)',
    example: '+14165551234',
    type: String,
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  phoneNumber: string;

  @ApiProperty({ type: () => CreateAddressDto, description: 'Adresse du magasin' })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => CreateAddressDto)
  address: CreateAddressDto;

  @ApiPropertyOptional({
    type: () => [StoreShippingZoneDto],
    description: 'Zones de livraison (distance min/max en km et prix)',
    minItems: 1,
  })
  @IsNotEmpty()
  @ValidateNested()
  @ArrayMinSize(1)
  @Type(() => StoreShippingZoneDto)
  @ValidateIf((o) => o.shippingZones?.length > 0 || o.supportsShipping)
  shippingZones?: StoreShippingZoneDto[];
}

/** Logo boutique : évite multipart (souvent cassé derrière Cloud Functions / certains proxys). */
export class StoreProfileImageJsonDto {
  @ApiProperty({
    description: 'Image en base64 (pur ou préfixe data:image/...;base64,)',
  })
  @IsNotEmpty()
  @IsString()
  imageBase64: string;

  @ApiPropertyOptional({ example: 'logo.png' })
  @IsOptional()
  @IsString()
  filename?: string;
}
