import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Trim } from 'class-sanitizer';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateStockItemDto {
  @ApiProperty({ example: 'Poisson fumé' })
  @IsNotEmpty()
  @Trim()
  produit: string;

  @ApiPropertyOptional({ example: 'kg', default: 'kg' })
  @IsOptional()
  @ValidateIf((o) => o.unite !== undefined)
  @IsNotEmpty()
  @Trim()
  unite?: string;

  @ApiPropertyOptional({ example: 0, type: Number, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantite?: number;

  @ApiPropertyOptional({ example: 0, type: Number, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  seuil?: number;

  @ApiPropertyOptional({
    example: 0,
    type: Number,
    default: 0,
    description: 'Prix unitaire (ex. FCFA)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  prix?: number;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class PatchStockItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((o) => o.produit !== undefined)
  @IsNotEmpty()
  @Trim()
  produit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((o) => o.unite !== undefined)
  @IsNotEmpty()
  @Trim()
  unite?: string;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantite?: number;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  seuil?: number;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  prix?: number;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
