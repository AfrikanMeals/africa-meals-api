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

  @ApiPropertyOptional({
    description: 'Gift code plateforme appliqué au panier.',
  })
  @IsOptional()
  @IsString()
  giftCode?: string;

  @ApiPropertyOptional({
    description:
      'Destinataire d’une commande offerte (ObjectId). Le JWT paie ; `order.user` = destinataire, `order.paidBy` = offreur. Distinct de `giftCode`.',
    example: '507f1f77bcf86cd799439011',
  })
  @IsOptional()
  @IsString()
  giftRecipientUserId?: string;

  @ApiPropertyOptional({
    description:
      'Métadonnées pré-commande par boutique (date/heure planifiée, note client).',
    example: {
      storeMongoId24Hex: {
        scheduledAt: '2026-07-15T12:00:00.000Z',
        customerNote: 'Sans piment',
      },
    },
  })
  @IsOptional()
  @IsObject()
  preOrderByStoreId?: Record<
    string,
    { scheduledAt: string; customerNote?: string }
  >;

  @ApiPropertyOptional({
    description:
      'Pré-commande impayée existante par boutique — évite de recréer une commande au paiement.',
    example: { storeMongoId24Hex: 'orderMongoId24Hex' },
  })
  @IsOptional()
  @IsObject()
  preOrderOidByStoreId?: Record<string, string>;
}
