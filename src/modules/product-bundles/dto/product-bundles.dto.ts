import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  BundleDiscountTypeEnum,
  BundleItemTypeEnum,
  ProductBundleStatusEnum,
} from '@schemas/product-bundle.schema';

/** DTO d'un item au sein d'un bundle (création / mise à jour). */
export class BundleItemDto {
  @ApiProperty({ enum: BundleItemTypeEnum })
  @IsEnum(BundleItemTypeEnum)
  itemType: BundleItemTypeEnum;

  @ApiPropertyOptional({ description: 'ID produit catalogue (si itemType = product)' })
  @IsOptional()
  @IsMongoId()
  productId?: string;

  @ApiPropertyOptional({ description: 'ID boisson (si itemType = drink)' })
  @IsOptional()
  @IsMongoId()
  drinkId?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  /** Labels de variantes autorisées (vide = toutes). */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedVariantLabels?: string[];

  /** Titres de groupes compléments autorisés (vide = tous). */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedComplementGroupTitles?: string[];

  /** Noms de suppléments autorisés (vide = tous). */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedSupplementNames?: string[];
}

export class CreateProductBundleDto {
  @ApiProperty({ description: 'Nom du bundle (FR)' })
  @IsString()
  @IsNotEmpty()
  nameFr: string;

  @ApiProperty({ description: 'Nom du bundle (EN)' })
  @IsString()
  @IsNotEmpty()
  nameEn: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descriptionFr?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descriptionEn?: string;

  @ApiPropertyOptional({ description: 'URL image de couverture' })
  @IsOptional()
  @IsString()
  image?: string;

  @ApiProperty({ type: [BundleItemDto], minItems: 2 })
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => BundleItemDto)
  items: BundleItemDto[];

  @ApiProperty({ enum: BundleDiscountTypeEnum })
  @IsEnum(BundleDiscountTypeEnum)
  discountType: BundleDiscountTypeEnum;

  @ApiProperty({ description: 'Valeur de la remise (% ou fixe)', minimum: 0 })
  @IsNumber()
  @Min(0)
  discountValue: number;

  @ApiPropertyOptional({ description: 'Date début de validité' })
  @IsOptional()
  @Type(() => Date)
  validFrom?: Date;

  @ApiPropertyOptional({ description: 'Date fin de validité' })
  @IsOptional()
  @Type(() => Date)
  validUntil?: Date;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  /** Quantité en stock catalogue (comme boissons). Défaut 0. */
  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  quantite?: number;

  /** Seuil d'alerte stock (comme boissons). Défaut 0. */
  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  seuil?: number;
}

export class PatchProductBundleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nameFr?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  nameEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descriptionFr?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  descriptionEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  image?: string;

  @ApiPropertyOptional({ type: [BundleItemDto], minItems: 2 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ValidateNested({ each: true })
  @Type(() => BundleItemDto)
  items?: BundleItemDto[];

  @ApiPropertyOptional({ enum: BundleDiscountTypeEnum })
  @IsOptional()
  @IsEnum(BundleDiscountTypeEnum)
  discountType?: BundleDiscountTypeEnum;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  discountValue?: number;

  @ApiPropertyOptional({ enum: ProductBundleStatusEnum })
  @IsOptional()
  @IsEnum(ProductBundleStatusEnum)
  status?: ProductBundleStatusEnum;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  validFrom?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  validUntil?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  /** Quantité en stock catalogue. */
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  quantite?: number;

  /** Seuil d'alerte stock. */
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  seuil?: number;
}

export class ProductBundleFeedQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 10, default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  take?: number;

  @ApiPropertyOptional({ description: 'Code région (ex. CM, CA)' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  regionCode?: string;

  /** Filtre par boutique — retourne uniquement les bundles de cette boutique. */
  @ApiPropertyOptional({ description: 'ID boutique (filtre page boutique mobile)' })
  @IsOptional()
  @IsMongoId()
  storeId?: string;
}

export class TrackProductBundleDto {
  @ApiProperty({ enum: ['click', 'checkout_start'] })
  @IsIn(['click', 'checkout_start'])
  event: 'click' | 'checkout_start';
}

/** Personnalisation d'un item du bundle au moment de l'ajout au panier. */
export class BundleCartItemCustomizationDto {
  @ApiProperty({ description: 'Index de l\'item dans le bundle (0-based)' })
  @IsInt()
  @Min(0)
  itemIndex: number;

  @ApiPropertyOptional({ description: 'Label de la variante choisie' })
  @IsOptional()
  @IsString()
  selectedVariantLabel?: string;

  @ApiPropertyOptional({
    description: 'Compléments choisis { groupTitle, options: [{ label, priceDelta? }] }',
  })
  @IsOptional()
  @IsArray()
  selectedComplements?: Array<{
    groupTitle: string;
    options: Array<{ label: string; priceDelta?: number }>;
  }>;

  @ApiPropertyOptional({
    description: 'Suppléments choisis { name, price? }',
  })
  @IsOptional()
  @IsArray()
  selectedSupplements?: Array<{ name: string; price?: number }>;
}

export class AddBundleToCartDto {
  @ApiProperty({ type: [BundleCartItemCustomizationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BundleCartItemCustomizationDto)
  itemCustomizations: BundleCartItemCustomizationDto[];
}
