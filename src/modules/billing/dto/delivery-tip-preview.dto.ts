import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class DeliveryTipPreviewDto {
  @ApiPropertyOptional({
    description: 'Adresse livraison (requise si au moins une boutique en livraison).',
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

  @ApiProperty({
    example: 1200,
    description: 'Pourboire total souhaité (centimes). 0 = aucun.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  deliveryTipTotalCents: number;
}
