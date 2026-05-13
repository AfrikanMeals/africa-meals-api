import { OrderStatusEnum } from '@schemas/order.schema';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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
