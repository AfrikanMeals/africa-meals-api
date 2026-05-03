import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Trim } from 'class-sanitizer';
import { Transform, Type } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateDrinkDto {
  @ApiProperty({ example: 'Bissap' })
  @IsNotEmpty()
  @Trim()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ example: 'Boisson à base de fleurs d’hibiscus' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Trim()
  description?: string;

  @ApiProperty({ example: 24, type: Number })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantite: number;

  @ApiProperty({ example: 6, type: Number })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  seuil: number;

  @ApiProperty({
    example: 3.5,
    type: Number,
    description: 'Montant en dollars canadiens (CAD)',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceCad: number;
}

/** Création boisson : JSON + image base64 optionnelle (évite multipart tronqué). */
export class CreateDrinkJsonDto extends CreateDrinkDto {
  @ApiPropertyOptional({
    description: 'Image optionnelle (base64 pur ou préfixe data:image/...;base64,)',
  })
  @IsOptional()
  @IsString()
  imageBase64?: string;

  @ApiPropertyOptional({ example: 'boisson.jpg' })
  @IsOptional()
  @IsString()
  filename?: string;
}

export class PatchDrinkDto {
  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((o) => o.name !== undefined)
  @IsNotEmpty()
  @Trim()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Trim()
  description?: string;

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

  @ApiPropertyOptional({ type: Number, description: 'Montant en CAD' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  priceCad?: number;

  @ApiPropertyOptional({
    description: 'Retirer l’image existante (sans envoyer de nouveau fichier)',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  clearImage?: boolean;
}

/** Mise à jour boisson : JSON partiel + image base64 optionnelle. */
export class PatchDrinkJsonDto extends PartialType(CreateDrinkDto) {
  @ApiPropertyOptional({
    description: 'Retirer l’image existante (sans envoyer imageBase64)',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  clearImage?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  imageBase64?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  filename?: string;
}
