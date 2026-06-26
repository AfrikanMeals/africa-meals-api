import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class ResetStripeConnectDto {
  @ApiPropertyOptional({
    description:
      'Si true, copie les commandes ouvertes (payées / approuvées / en livraison) avant réinitialisation.',
  })
  @IsOptional()
  @IsBoolean()
  archiveOpenOrders?: boolean;
}
