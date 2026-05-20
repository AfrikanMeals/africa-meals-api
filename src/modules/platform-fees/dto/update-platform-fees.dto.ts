import { PLATFORM_FEE_MODES } from '@schemas/platform-fees-settings.schema';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UpdatePlatformFeesDto {
  @ApiPropertyOptional({ example: 'CAD' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ enum: PLATFORM_FEE_MODES })
  @IsOptional()
  @IsIn(PLATFORM_FEE_MODES)
  refundFeeMode?: (typeof PLATFORM_FEE_MODES)[number];

  @ApiPropertyOptional({ example: 1.5, description: 'Frais fixe par remboursement' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  refundFeeFixed?: number;

  @ApiPropertyOptional({
    example: 2.5,
    description: 'Pourcentage du montant remboursé',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  refundFeePercent?: number;

  @ApiPropertyOptional({ enum: PLATFORM_FEE_MODES })
  @IsOptional()
  @IsIn(PLATFORM_FEE_MODES)
  orderPaymentFeeMode?: (typeof PLATFORM_FEE_MODES)[number];

  @ApiPropertyOptional({
    example: 0.3,
    description: 'Frais fixe par paiement commande (Stripe, etc.)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  orderPaymentFeeFixed?: number;

  @ApiPropertyOptional({
    example: 2.9,
    description: 'Pourcentage du montant payé (ex. frais carte)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  orderPaymentFeePercent?: number;

  @ApiPropertyOptional({ enum: PLATFORM_FEE_MODES })
  @IsOptional()
  @IsIn(PLATFORM_FEE_MODES)
  mlmCommissionMode?: (typeof PLATFORM_FEE_MODES)[number];

  @ApiPropertyOptional({
    example: 2,
    description: 'Commission MLM fixe par commande',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  mlmCommissionFixed?: number;

  @ApiPropertyOptional({
    example: 5,
    description: 'Commission MLM (% du sous-total commande)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  mlmCommissionPercent?: number;

  @ApiPropertyOptional({
    example: 25,
    description: 'Plafond $ par commande pour MLM (0 = pas de plafond)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  mlmCommissionCapPerOrder?: number;

  @ApiPropertyOptional({ enum: PLATFORM_FEE_MODES })
  @IsOptional()
  @IsIn(PLATFORM_FEE_MODES)
  platformOrderFeeMode?: (typeof PLATFORM_FEE_MODES)[number];

  @ApiPropertyOptional({
    example: 0.5,
    description: 'Frais de service plateforme fixe par commande',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  platformOrderFeeFixed?: number;

  @ApiPropertyOptional({
    example: 8,
    description: 'Commission plateforme (% du montant commande)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  platformOrderFeePercent?: number;
}
