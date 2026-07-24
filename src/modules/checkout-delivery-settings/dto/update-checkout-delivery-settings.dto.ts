import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import {
  MAX_COURIER_NEAR_CUSTOMER_RADIUS_METERS,
  MIN_COURIER_NEAR_CUSTOMER_RADIUS_METERS,
} from '../checkout-delivery-settings.util';

export class UpdateCheckoutDeliverySettingsDto {
  @ApiPropertyOptional({
    description:
      'Si true, le checkout mobile cache Livraison lorsqu’aucun coursier n’est disponible.',
  })
  @IsOptional()
  @IsBoolean()
  hideDeliveryWhenNoCourierAvailable?: boolean;

  @ApiPropertyOptional({
    description:
      'Rayon (mètres) pour notifier le client que le livreur est proche de l’adresse.',
    minimum: MIN_COURIER_NEAR_CUSTOMER_RADIUS_METERS,
    maximum: MAX_COURIER_NEAR_CUSTOMER_RADIUS_METERS,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_COURIER_NEAR_CUSTOMER_RADIUS_METERS)
  @Max(MAX_COURIER_NEAR_CUSTOMER_RADIUS_METERS)
  courierNearCustomerRadiusMeters?: number;
}
