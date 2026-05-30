import { ApiProperty } from '@nestjs/swagger';
import { IsMongoId } from 'class-validator';

export class ShippingQuoteDto {
  @ApiProperty({ description: 'ID Mongo de la boutique' })
  @IsMongoId()
  storeId: string;

  @ApiProperty({
    description: 'ID Mongo de l’adresse de livraison (profil client)',
  })
  @IsMongoId()
  addressId: string;
}
