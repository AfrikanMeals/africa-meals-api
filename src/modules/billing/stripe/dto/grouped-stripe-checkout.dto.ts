import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class GroupedStripeCouponLineDto {
  @ApiProperty()
  @IsString()
  storeId: string;

  @ApiProperty()
  @IsString()
  code: string;
}

export class GroupedStripeCheckoutDto {
  @ApiPropertyOptional({
    description:
      'Identifiant adresse livraison (requis si au moins une boutique est en livraison avec frais).',
  })
  @IsOptional()
  @IsString()
  addressId?: string;

  @ApiProperty({
    description: 'Par boutique : "delivery" ou "pickup".',
    example: { storeMongoId24Hex: 'delivery' },
  })
  @IsObject()
  fulfillmentByStoreId: Record<string, string>;

  @ApiPropertyOptional({
    description:
      'Par boutique : true = paiement à la collecte (pickup, sans Stripe en ligne). Les autres boutiques restent sur Stripe.',
    example: { storeMongoId24Hex: true },
  })
  @IsOptional()
  @IsObject()
  payOnPickupByStoreId?: Record<string, boolean>;

  @ApiPropertyOptional({ type: [GroupedStripeCouponLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GroupedStripeCouponLineDto)
  coupons?: GroupedStripeCouponLineDto[];

  @ApiPropertyOptional({
    description:
      'Devise de paiement attendue côté client (ex. CAD). Doit correspondre à la devise résolue du panier.',
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({
    example: 1200,
    description:
      'Pourboire livreur total (centimes). Réparti côté serveur sur les commandes livraison.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  deliveryTipTotalCents?: number;
}
