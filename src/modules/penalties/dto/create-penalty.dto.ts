import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { PENALTY_REASON_OTHER } from '../penalty-reasons';
import { PenaltyRouteEnum, PENALTY_ROUTE_VALUES } from '../penalty.types';

export class CreatePenaltyDto {
  @ApiProperty({ enum: PENALTY_ROUTE_VALUES })
  @IsEnum(PenaltyRouteEnum)
  route: PenaltyRouteEnum;

  @ApiProperty({ description: 'Montant en centimes (entier positif).' })
  @IsInt()
  @Min(1)
  @Max(50_000_000)
  amountCents: number;

  @ApiPropertyOptional({ example: 'cad' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsMongoId()
  orderId?: string;

  @ApiPropertyOptional({ description: 'Boutique (flux vendeur).' })
  @IsOptional()
  @IsMongoId()
  storeId?: string;

  @ApiPropertyOptional({ description: 'Propriétaire vendeur (si pas de storeId).' })
  @IsOptional()
  @IsMongoId()
  vendorUserId?: string;

  @ApiPropertyOptional({ description: 'Compte livreur DELIVERY.' })
  @IsOptional()
  @IsMongoId()
  deliveryUserId?: string;

  @ApiPropertyOptional({ example: 'late_delivery' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reasonCode?: string;

  @ApiPropertyOptional({
    description: 'Obligatoire si reasonCode = other (min. 10 caractères).',
  })
  @IsOptional()
  @IsString()
  @ValidateIf((o) => o.reasonCode === PENALTY_REASON_OTHER)
  @MinLength(10)
  @MaxLength(500)
  reasonDetails?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  notifyParticipants?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({
    description: 'Clé idempotence Stripe / doublon (max 120 car.).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;
}

export class ListPenaltiesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  page?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  take?: string;

  @ApiPropertyOptional({ enum: PENALTY_ROUTE_VALUES })
  @IsOptional()
  @IsEnum(PenaltyRouteEnum)
  route?: PenaltyRouteEnum;
}
