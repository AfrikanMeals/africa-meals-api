import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export enum CartSimulatorFulfillmentMode {
  DELIVERY = 'delivery',
  PICKUP = 'pickup',
}

export class CartSimulatorComplementOptionDto {
  @ApiProperty()
  @IsString()
  label: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceDelta?: number;
}

export class CartSimulatorComplementGroupDto {
  @ApiProperty()
  @IsString()
  groupTitle: string;

  @ApiProperty({ type: [CartSimulatorComplementOptionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartSimulatorComplementOptionDto)
  options: CartSimulatorComplementOptionDto[];
}

export class CartSimulatorSupplementDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;
}

export class CartSimulatorItemDto {
  @ApiPropertyOptional({
    description: 'Identifiant produit MongoDB (catalogue). Absent si prix libre.',
  })
  @IsOptional()
  @IsString()
  productId?: string;

  @ApiProperty({ minimum: 1, maximum: 99, default: 1 })
  @IsInt()
  @Min(1)
  @Max(99)
  quantity: number;

  @ApiPropertyOptional({
    description: 'Prix unitaire affiché (obligatoire pour une ligne prix libre)',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @ApiPropertyOptional({
    description: 'Libellé ligne prix libre',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional({ description: 'Libellé variante sélectionnée' })
  @IsOptional()
  @IsString()
  selectedVariantLabel?: string;

  @ApiPropertyOptional({ type: [CartSimulatorComplementGroupDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartSimulatorComplementGroupDto)
  selectedComplements?: CartSimulatorComplementGroupDto[];

  @ApiPropertyOptional({ type: [CartSimulatorSupplementDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartSimulatorSupplementDto)
  selectedSupplements?: CartSimulatorSupplementDto[];
}

export class CartSimulatorPreviewDto {
  @ApiProperty({ description: 'Boutique simulée' })
  @IsString()
  storeId: string;

  @ApiProperty({ enum: CartSimulatorFulfillmentMode })
  @IsEnum(CartSimulatorFulfillmentMode)
  fulfillmentMode: CartSimulatorFulfillmentMode;

  @ApiProperty({ type: [CartSimulatorItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CartSimulatorItemDto)
  items: CartSimulatorItemDto[];

  @ApiPropertyOptional({
    description: 'Pourboire livreur (montant affiché, ex. 500 XAF)',
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryTip?: number;

  @ApiPropertyOptional({ description: 'Latitude adresse client (livraison)' })
  @IsOptional()
  @IsNumber()
  deliveryLatitude?: number;

  @ApiPropertyOptional({ description: 'Longitude adresse client (livraison)' })
  @IsOptional()
  @IsNumber()
  deliveryLongitude?: number;

  @ApiPropertyOptional({
    description: 'Code pays ISO2 livraison (taxes si différent de la boutique)',
    example: 'CM',
  })
  @IsOptional()
  @IsString()
  deliveryCountryCode?: string;

  @ApiPropertyOptional({
    description: 'Libellé adresse (affichage uniquement)',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  customerAddressLabel?: string;

  @ApiPropertyOptional({
    description: 'Code promo boutique (soft-fail si invalide)',
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  couponCode?: string;
}
