import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Trim } from 'class-sanitizer';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true' || value === 1 || value === '1') {
    return true;
  }
  if (value === false || value === 'false' || value === 0 || value === '0') {
    return false;
  }
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return Boolean(value);
}

export class CreateIngredientLibraryDto {
  @ApiProperty({ example: 'Tomate' })
  @IsNotEmpty()
  @Trim()
  name: string;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  active?: boolean;
}

export class PatchIngredientLibraryDto {
  @ApiPropertyOptional({ example: 'Tomate cerise' })
  @IsOptional()
  @Trim()
  name?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  active?: boolean;
}

export class CreateSupplementLibraryDto {
  @ApiProperty({ example: 'Fromage extra' })
  @IsNotEmpty()
  @Trim()
  name: string;

  @ApiPropertyOptional({ example: 2.5, type: Number })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return value;
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  })
  @IsNumber()
  @Min(0)
  defaultPrice?: number;
}

export class PatchSupplementLibraryDto {
  @ApiPropertyOptional({ example: 'Fromage extra' })
  @IsOptional()
  @Trim()
  name?: string;

  @ApiPropertyOptional({ example: 2.5, type: Number })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return value;
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  })
  @IsNumber()
  @Min(0)
  defaultPrice?: number;
}

export class ComplementLibraryOptionDto {
  @ApiProperty({ example: 'Grand' })
  @IsNotEmpty()
  @Trim()
  label: string;

  @ApiPropertyOptional({ example: 1.5, type: Number })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return value;
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  })
  @IsNumber()
  @Min(0)
  defaultPriceDelta?: number;

  @ApiPropertyOptional({ example: false, type: Boolean })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  isDefault?: boolean;
}

export class CreateComplementLibraryDto {
  @ApiProperty({ example: 'Taille' })
  @IsNotEmpty()
  @Trim()
  title: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  firstOptionFree?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  multiChoice?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  required?: boolean;

  @ApiProperty({ type: [ComplementLibraryOptionDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComplementLibraryOptionDto)
  options: ComplementLibraryOptionDto[];
}

export class PatchComplementLibraryDto {
  @ApiPropertyOptional({ example: 'Taille' })
  @IsOptional()
  @Trim()
  title?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  firstOptionFree?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  multiChoice?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ type: [ComplementLibraryOptionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComplementLibraryOptionDto)
  options?: ComplementLibraryOptionDto[];
}
