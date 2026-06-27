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
  Min,
  ValidateNested,
} from 'class-validator';

export enum CartSimulatorFulfillmentMode {
  DELIVERY = 'delivery',
  PICKUP = 'pickup',
}

export class CartSimulatorItemDto {
  @ApiProperty({ description: 'Identifiant produit MongoDB' })
  @IsString()
  productId: string;

  @ApiProperty({ minimum: 1, maximum: 99, default: 1 })
  @IsInt()
  @Min(1)
  @Max(99)
  quantity: number;
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
}
