import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsOptional } from 'class-validator';

export class ShippingQuoteDto {
  @ApiProperty({ description: 'ID Mongo de la boutique' })
  @IsMongoId()
  storeId: string;

  @ApiProperty({
    description: 'ID Mongo de l’adresse de livraison (profil client)',
  })
  @IsMongoId()
  addressId: string;

  @ApiPropertyOptional({
    description:
      'Destinataire commande offerte : l’adresse doit appartenir à ce user (pas au JWT payeur).',
  })
  @IsOptional()
  @IsMongoId()
  giftRecipientUserId?: string;
}
