import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
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

  @ApiPropertyOptional({ type: [GroupedStripeCouponLineDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GroupedStripeCouponLineDto)
  coupons?: GroupedStripeCouponLineDto[];
}
