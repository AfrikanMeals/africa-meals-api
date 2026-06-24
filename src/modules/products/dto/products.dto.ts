import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  EstimatedCookingTimeUnitEnum,
  ProductStatusEnum,
} from '@schemas/product.schema';
import { Trim } from 'class-sanitizer';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
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
  @Transform(({ value }) => toOptionalBoolean(value))
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
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  firstOptionFree?: boolean;

  @ApiPropertyOptional({
    example: false,
    description: 'Si true, plusieurs options peuvent être sélectionnées (cases à cocher).',
  })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  multiChoice?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      'Si true, le client doit choisir au moins une option. Sinon l’app propose « Aucun » (sans surcoût).',
  })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ type: [ProductComplementOptionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductComplementOptionDto)
  options?: ProductComplementOptionDto[];
}

export class ProductVariantDto {
  @ApiProperty({ example: 'Medium' })
  @IsNotEmpty()
  @Trim()
  label: string;

  @ApiProperty({ example: 12.99, type: Number })
  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return value;
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiPropertyOptional({ example: 0, type: Number })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return value;
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  })
  @IsNumber()
  @Min(0)
  discountPrice?: number;

  @ApiPropertyOptional({ example: true, type: Boolean })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean()
  isDefault?: boolean;
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

  @ApiPropertyOptional({
    example: 30,
    description: 'Temps de cuisson estimé (valeur entière positive).',
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  estimatedCookingTime?: number;

  @ApiPropertyOptional({
    enum: EstimatedCookingTimeUnitEnum,
    example: EstimatedCookingTimeUnitEnum.MINUTE,
    description: 'Unité du temps de cuisson estimé (s | m | h).',
  })
  @ValidateIf((o) => o.estimatedCookingTime != null && o.estimatedCookingTime > 0)
  @IsIn(Object.values(EstimatedCookingTimeUnitEnum))
  estimatedCookingTimeUnit?: EstimatedCookingTimeUnitEnum;

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
  @ValidateNested({ each: true })
  @Type(() => ProductComplementGroupDto)
  complements?: ProductComplementGroupDto[];

  @ApiPropertyOptional({
    type: [ProductSupplementDto],
    description: 'Suppléments simples (nom + prix).',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductSupplementDto)
  supplements?: ProductSupplementDto[];

  @ApiPropertyOptional({
    type: [ProductVariantDto],
    description:
      'Variantes de prix (ex. tailles). Si présentes, prix & promo affichés = variante par défaut.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductVariantDto)
  variants?: ProductVariantDto[];

  @ApiPropertyOptional({
    example: 'Taille',
    description: 'Libellé du groupe de variantes affiché au client (ex. « Taille »).',
  })
  @IsOptional()
  @IsString()
  @Trim()
  variantsLabel?: string;

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

  @ApiPropertyOptional({
    example: 30,
    description:
      'Temps de cuisson estimé (valeur entière positive). Null pour effacer.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsNumber()
  @Min(1)
  estimatedCookingTime?: number | null;

  @ApiPropertyOptional({
    enum: EstimatedCookingTimeUnitEnum,
    description: 'Unité du temps de cuisson estimé (s | m | h). Null pour effacer.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v != null)
  @IsIn(Object.values(EstimatedCookingTimeUnitEnum))
  estimatedCookingTimeUnit?: EstimatedCookingTimeUnitEnum | null;

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
  @ValidateNested({ each: true })
  @Type(() => ProductComplementGroupDto)
  complements?: ProductComplementGroupDto[];

  @ApiPropertyOptional({
    type: [ProductSupplementDto],
    description: 'Suppléments simples (nom + prix).',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductSupplementDto)
  supplements?: ProductSupplementDto[];

  @ApiPropertyOptional({
    type: [ProductVariantDto],
    description: 'Variantes de prix (tailles, etc.).',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductVariantDto)
  variants?: ProductVariantDto[];

  @ApiPropertyOptional({
    example: 'Taille',
    description: 'Libellé du groupe de variantes affiché au client (ex. « Taille »).',
  })
  @IsOptional()
  @IsString()
  @Trim()
  variantsLabel?: string;

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
