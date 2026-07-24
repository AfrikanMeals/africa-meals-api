import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateCheckoutDeliverySettingsDto {
  @ApiPropertyOptional({
    description:
      'Si true, le checkout mobile cache Livraison lorsqu’aucun coursier n’est disponible.',
  })
  @IsOptional()
  @IsBoolean()
  hideDeliveryWhenNoCourierAvailable?: boolean;
}
