import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductStatusEnum } from '@schemas/product.schema';
import { Trim } from 'class-sanitizer';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ProductComplementOptionDto {
  @ApiProperty({ example: 'Moyen' })
  @IsNotEmpty()
  @Trim()
  label: string;

  @ApiPropertyOptional({ example: 0, type: Number })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return value;
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  })
  @IsNumber()
  @Min(0)
  priceDelta?: number;

  @ApiPropertyOptional({ example: false, type: Boolean })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isDefault?: boolean;
}

export class ProductComplementGroupDto {
  @ApiProperty({ example: 'Taille' })
  @IsNotEmpty()
  @Trim()
  title: string;

  @ApiPropertyOptional({ example: false, type: Boolean })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  firstOptionFree?: boolean;

  @ApiPropertyOptional({ type: [ProductComplementOptionDto] })
  @IsOptional()
  @IsArray()
  options?: ProductComplementOptionDto[];
}

export class ProductSupplementDto {
  @ApiProperty({ example: 'Sauce piment' })
  @IsNotEmpty()
  @Trim()
  name: string;

  @ApiPropertyOptional({ example: 0, type: Number })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return value;
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  })
  @IsNumber()
  @Min(0)
  price?: number;
}

export class ProductDiscountScheduleDto {
  @ApiPropertyOptional({ example: 'Promo week-end' })
  @IsOptional()
  @Trim()
  label?: string;

  @ApiProperty({ example: '2026-06-01T08:00:00.000Z' })
  @IsNotEmpty()
  @IsDateString()
  startAt: string;

  @ApiProperty({ example: '2026-06-30T23:59:00.000Z' })
  @IsNotEmpty()
  @IsDateString()
  endAt: string;

  @ApiProperty({ example: 12.99, type: Number })
  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return value;
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: 9.99, type: Number })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return value;
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  })
  @IsNumber()
  @Min(0)
  discountPrice?: number;
}

export class CreateProductDto {
  @ApiProperty({ example: 'Poulet braisé' })
  @IsNotEmpty()
  @Trim()
  title: string;

  @ApiProperty({ example: 'Plat traditionnel' })
  @IsNotEmpty()
  @Trim()
  bio: string;

  @ApiProperty({ example: 'Sénégal' })
  @IsNotEmpty()
  @Trim()
  originCountry: string;

  @ApiProperty({ example: 12.99, type: Number })
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: 0, type: Number })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountPrice?: number;

  @ApiPropertyOptional({ example: 'CAD' })
  @IsOptional()
  @Trim()
  currency?: string;

  @ApiPropertyOptional({ enum: ProductStatusEnum })
  @IsOptional()
  @IsEnum(ProductStatusEnum)
  status?: ProductStatusEnum;

  @ApiPropertyOptional({ example: 'Description détaillée' })
  @IsOptional()
  @Trim()
  about?: string;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @IsNotEmpty()
  @Trim()
  category: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Liste d’ingrédients (chaînes).',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fieldsets?: string[];

  @ApiPropertyOptional({
    type: [ProductComplementGroupDto],
    description: 'Groupes de compléments (options + prix + option par défaut).',
  })
  @IsOptional()
  @IsArray()
  complements?: ProductComplementGroupDto[];

  @ApiPropertyOptional({
    type: [ProductSupplementDto],
    description: 'Suppléments simples (nom + prix).',
  })
  @IsOptional()
  @IsArray()
  supplements?: ProductSupplementDto[];

  @ApiPropertyOptional({
    example: 12.99,
    description: 'Prix catalogue hors promotion planifiée.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  listPrice?: number;

  @ApiPropertyOptional({
    example: 0,
    description: 'Promo catalogue hors fenêtre planifiée (0 = aucune).',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  listDiscountPrice?: number;

  @ApiPropertyOptional({
    type: [ProductDiscountScheduleDto],
    description: 'Promotions planifiées (prix + promo par plage de dates).',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductDiscountScheduleDto)
  discountSchedules?: ProductDiscountScheduleDto[];
}

export class PatchProductDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNotEmpty()
  @Trim()
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNotEmpty()
  @Trim()
  bio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  about?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNotEmpty()
  @Trim()
  originCountry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Trim()
  currency?: string;

  @ApiPropertyOptional({ enum: ProductStatusEnum })
  @IsOptional()
  @IsEnum(ProductStatusEnum)
  status?: ProductStatusEnum;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNotEmpty()
  @Trim()
  category?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Liste d’ingrédients (chaînes).',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fieldsets?: string[];

  @ApiPropertyOptional({
    type: [ProductComplementGroupDto],
    description: 'Groupes de compléments (options + prix + option par défaut).',
  })
  @IsOptional()
  @IsArray()
  complements?: ProductComplementGroupDto[];

  @ApiPropertyOptional({
    type: [ProductSupplementDto],
    description: 'Suppléments simples (nom + prix).',
  })
  @IsOptional()
  @IsArray()
  supplements?: ProductSupplementDto[];

  @ApiPropertyOptional({
    description: 'Prix catalogue hors promotion planifiée.',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  listPrice?: number;

  @ApiPropertyOptional({
    description: 'Promo catalogue hors fenêtre planifiée (0 = aucune).',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  listDiscountPrice?: number;

  @ApiPropertyOptional({
    type: [ProductDiscountScheduleDto],
    description: 'Promotions planifiées (prix + promo par plage de dates).',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductDiscountScheduleDto)
  discountSchedules?: ProductDiscountScheduleDto[];

  @ApiPropertyOptional({
    description:
      'Si true, supprime les images de galerie (sans en envoyer de nouvelles).',
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  clearGallery?: boolean;
}

/**
 * Création produit en JSON + base64 (évite multipart tronqué derrière Firebase / proxys).
 */
export class CreateProductJsonDto extends CreateProductDto {
  @ApiPropertyOptional({
    description:
      'Image principale (base64 pur ou préfixe data:image/...;base64,)',
  })
  @IsOptional()
  @IsString()
  imageBase64?: string;

  @ApiPropertyOptional({ example: 'plat.jpg' })
  @IsOptional()
  @IsString()
  imageFilename?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Jusqu’à 2 images galerie (base64 chacune)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  galleryBase64?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  galleryFilenames?: string[];
}

/**
 * Mise à jour produit (métadonnées + images) en JSON + base64.
 */
export class PatchProductJsonDto extends PatchProductDto {
  @ApiPropertyOptional({
    description:
      'Nouvelle image principale (base64 pur ou préfixe data:image/...;base64,)',
  })
  @IsOptional()
  @IsString()
  imageBase64?: string;

  @ApiPropertyOptional({ example: 'plat.jpg' })
  @IsOptional()
  @IsString()
  imageFilename?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  galleryBase64?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  galleryFilenames?: string[];
}

export class CreateProductExtraDto {
  @ApiProperty({ example: 'Sauce supplémentaire' })
  @IsNotEmpty()
  @Trim()
  title: string;

  @ApiProperty({ example: 'Sauce piquante maison' })
  @IsNotEmpty()
  @Trim()
  description: string;

  @ApiProperty({ example: 1.5, type: Number })
  @IsNotEmpty()
  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return value;
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ type: 'string', format: 'binary' })
  @IsOptional()
  @Trim()
  image?: Express.Multer.File;

  @IsOptional()
  profileImage?: string;
}
