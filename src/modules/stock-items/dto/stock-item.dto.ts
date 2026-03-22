import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Trim } from 'class-sanitizer';
import { Type } from 'class-transformer';
import {
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

  @ApiProperty({ example: 'kg' })
  @IsNotEmpty()
  @Trim()
  unite: string;

  @ApiProperty({ example: 3, type: Number })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantite: number;

  @ApiProperty({ example: 5, type: Number })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  seuil: number;

  @ApiProperty({ example: 1500, type: Number, description: 'Prix unitaire (ex. FCFA)' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  prix: number;
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
}
