import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { GroupedStripeCheckoutDto } from './grouped-stripe-checkout.dto';

export class PreOrderStoreMetaDto {
  @ApiProperty({
    description: 'Date/heure de livraison ou retrait (ISO 8601).',
    example: '2026-07-15T12:00:00.000Z',
  })
  @IsDateString()
  scheduledAt: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  customerNote?: string;
}

export class PreOrderCheckoutDto extends GroupedStripeCheckoutDto {
  @ApiProperty({
    description:
      'Par boutique pré-commandée : date/heure planifiée et note client.',
    example: {
      '507f1f77bcf86cd799439011': {
        scheduledAt: '2026-07-15T12:00:00.000Z',
        customerNote: 'Sans piment',
      },
    },
  })
  @ValidateNested({ each: true })
  @Type(() => PreOrderStoreMetaDto)
  preOrderByStoreId: Record<string, PreOrderStoreMetaDto>;

  @ApiPropertyOptional({
    description:
      'Si true, crée la pré-commande sans paiement en ligne (statut `created`). Le client pourra payer plus tard.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  deferPayment?: boolean;
}
