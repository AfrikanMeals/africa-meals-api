import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class FilterGroupedPaymentsDto {
  @ApiPropertyOptional({
    description:
      'Filtre sur le canal Stripe : `payment_intent` (Payment Sheet / wallets) ou `checkout_session` (Checkout hébergé).',
    enum: ['payment_intent', 'checkout_session'],
  })
  @IsOptional()
  @IsIn(['payment_intent', 'checkout_session'])
  stripeEventKind?: 'payment_intent' | 'checkout_session';

  @ApiPropertyOptional({
    description:
      'Recherche sur l’identifiant Stripe (`pi_…`, `cs_…`) ou sur le nom d’une boutique concernée.',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 10_000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  skip?: number;
}
