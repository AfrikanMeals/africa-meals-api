import { CreateAddressDto } from '@modules/addresses/dto/addresses.dto';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
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

export class DailyMenuItemDto {
  @ApiProperty({ description: 'Identifiant du plat (produit) dans le catalogue' })
  @IsNotEmpty()
  @IsString()
  productId: string;

  @ApiProperty({
    description:
      'Si true, le plat reste disponible sans limite de portions pour ce jour (côté menu du jour).',
  })
  @IsBoolean()
  stockUnlimited: boolean;

  @ApiPropertyOptional({
    description:
      'Portions restantes pour ce jour (obligatoire si stockUnlimited = false). À 0 le plat est indisponible sur l’app.',
    minimum: 0,
    type: Number,
  })
  @ValidateIf((o) => !o.stockUnlimited)
  @IsInt()
  @Min(0)
  stockRemaining?: number;
}

export class DailyMenuSlotDto {
  @ApiProperty({ description: '0 = dimanche … 6 = samedi (comme Date.getDay())', minimum: 0, maximum: 6 })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Ancien format (IDs seuls). Utilisé seulement si `items` est absent ; chaque plat est alors traité comme illimité.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];

  @ApiPropertyOptional({
    type: () => [DailyMenuItemDto],
    description: 'Plats du jour avec stock illimité ou nombre de portions restantes.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DailyMenuItemDto)
  items?: DailyMenuItemDto[];
}

export class PatchDailyMenuDto {
  @ApiProperty({ type: [DailyMenuSlotDto] })
  @ValidateNested({ each: true })
  @Type(() => DailyMenuSlotDto)
  @IsArray()
  slots: DailyMenuSlotDto[];
}

/** Mise à jour des zones de livraison (tous statuts sauf INACTIVE). */
export class PatchVendorShippingZonesDto {
  @ApiProperty({ description: 'Livraison assurée par le restaurant' })
  @IsBoolean()
  supportsShipping: boolean;

  @ApiPropertyOptional({
    type: () => [StoreShippingZoneDto],
    description: 'Obligatoire d’avoir au moins une entrée si supportsShipping est true',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StoreShippingZoneDto)
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
