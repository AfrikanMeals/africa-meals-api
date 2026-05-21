import { OrderStatusEnum } from '@schemas/order.schema';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  CLIENT_ORDER_CANCEL_REASON_CODES,
  ORDER_CANCEL_REASON_OTHER,
  VENDOR_ORDER_CANCEL_REASON_CODES,
} from '../order-cancel-reasons';

export class FilterOrdersDto {
  @ApiPropertyOptional({ enum: OrderStatusEnum })
  @IsOptional()
  @IsEnum(OrderStatusEnum)
  status?: OrderStatusEnum;

  @ApiPropertyOptional({ example: '507f1f77bcf86cd799439011' })
  @IsOptional()
  storeId?: string;

  @ApiPropertyOptional({
    description:
      'Nombre max de commandes (tri par date décroissante). Défaut **80** si absent (liste mobile). Max 200.',
    minimum: 1,
    maximum: 200,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Pagination : nombre de commandes à sauter (tri `createdAt` desc). Max 10 000.',
    minimum: 0,
    maximum: 10_000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  skip?: number;

  @ApiPropertyOptional({
    description:
      'Filtre sur le nom de la boutique (recherche insensible à la casse, préfixe libre).',
    maxLength: 120,
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class ConfirmPickupDto {
  @ApiProperty({
    description: 'Code retrait affiché au client (6 caractères).',
    example: 'A1B0C2',
    minLength: 4,
    maxLength: 12,
  })
  @IsString()
  @MinLength(4)
  @MaxLength(12)
  code!: string;
}

export class CreateRefundRequestDto {
  @ApiProperty({
    description: 'Code motif prédéfini (liste client).',
    enum: CLIENT_ORDER_CANCEL_REASON_CODES,
    example: 'changed_mind',
  })
  @IsString()
  @IsIn([...CLIENT_ORDER_CANCEL_REASON_CODES])
  reasonCode!: string;

  @ApiPropertyOptional({
    description:
      'Précision obligatoire si `reasonCode` = `other` (min. 10 caractères). Optionnel sinon.',
    maxLength: 4000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  @ValidateIf((o) => o.reasonCode === ORDER_CANCEL_REASON_OTHER)
  @MinLength(10)
  details?: string;
}

export class RejectOrderDto {
  @ApiProperty({
    description: 'Code motif prédéfini (liste vendeur / admin).',
    enum: VENDOR_ORDER_CANCEL_REASON_CODES,
    example: 'out_of_stock',
  })
  @IsString()
  @IsIn([...VENDOR_ORDER_CANCEL_REASON_CODES])
  reasonCode!: string;

  @ApiPropertyOptional({
    description:
      'Précision obligatoire si `reasonCode` = `other` (min. 10 caractères).',
    maxLength: 4000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  @ValidateIf((o) => o.reasonCode === ORDER_CANCEL_REASON_OTHER)
  @MinLength(10)
  details?: string;
}
