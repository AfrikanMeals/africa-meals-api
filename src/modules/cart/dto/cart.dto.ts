import { CartItemModel, CartItemTypeEnum } from '@schemas/cart_item.schema';
import { StoreModel } from '@schemas/store.schema';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class CartLineComplementOptionDto {
  @ApiProperty({ example: 'Riz' })
  @IsNotEmpty()
  @IsString()
  label: string;

  @ApiPropertyOptional({ example: 2, type: Number })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return value;
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  })
  priceDelta?: number;
}

export class CartLineComplementGroupDto {
  @ApiProperty({ example: 'Accompagnement' })
  @IsNotEmpty()
  @IsString()
  groupTitle: string;

  @ApiPropertyOptional({ type: [CartLineComplementOptionDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartLineComplementOptionDto)
  options?: CartLineComplementOptionDto[];
}

export class CartLineSupplementDto {
  @ApiProperty({ example: 'Piment' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 1, type: Number })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => {
    if (value === '' || value === null || value === undefined) return value;
    const n = Number(value);
    return Number.isNaN(n) ? value : n;
  })
  price?: number;
}

export class RemoveItemFromCartDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @IsNotEmpty()
  itemId: string;

  @ApiProperty({ enum: CartItemTypeEnum })
  @IsNotEmpty()
  @IsEnum(CartItemTypeEnum)
  type: CartItemTypeEnum;
}

export class AddItemToCartDto {
  @ApiProperty({ enum: CartItemTypeEnum })
  @IsNotEmpty()
  @IsEnum(CartItemTypeEnum)
  type: CartItemTypeEnum;

  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @IsNotEmpty()
  itemId: string;

  @ApiProperty({ minimum: 1, example: 1, type: Number })
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => +value)
  quantity: number;

  @ApiProperty({ example: 9.99, type: Number })
  @IsNotEmpty()
  @IsNumber()
  @Transform(({ value }) => +value)
  price: number;

  @ApiProperty({
    example: '507f1f77bcf86cd799439012',
    description: 'Requis si type = PRODUCT_EXTRA',
  })
  @IsNotEmpty()
  @ValidateIf((o) => o.type === CartItemTypeEnum.PRODUCT_EXTRA)
  productId: string;

  @ApiPropertyOptional({
    type: [CartLineComplementGroupDto],
    description: 'Compléments choisis (produit uniquement).',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartLineComplementGroupDto)
  selectedComplements?: CartLineComplementGroupDto[];

  @ApiPropertyOptional({
    type: [CartLineSupplementDto],
    description: 'Suppléments choisis (produit uniquement).',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartLineSupplementDto)
  selectedSupplements?: CartLineSupplementDto[];

  @ApiPropertyOptional({
    example: 'Medium',
    description: 'Libellé de la variante de prix choisie (produit uniquement).',
  })
  @IsOptional()
  @IsString()
  selectedVariantLabel?: string;

  /** Référence bundle source — lignes d’un même combo. */
  @ApiPropertyOptional({
    example: '507f1f77bcf86cd799439011',
    description: 'ID du product_bundle (lignes combo).',
  })
  @IsOptional()
  @IsString()
  bundleId?: string;

  /** Titre combo figé (nameFr/nameEn) pour l’UI panier groupée. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bundleTitle?: string;

  /** UUID partagé entre les lignes d’un même ajout de bundle. */
  @ApiPropertyOptional({
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    description: 'Groupe panier pour un combo (1 UUID = 1 unité de bundle).',
  })
  @IsOptional()
  @IsString()
  bundleGroupId?: string;
}

export class CartItemApiResponse {
  store: StoreModel;
  items: Partial<CartItemModel>[];
  totalPrice: number;
}

/** `PATCH /cart/:id/quantity` — quantité absolue pour une ligne panier. */
export class UpdateCartLineQuantityDto {
  @ApiProperty({ minimum: 1, maximum: 999, example: 2 })
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(999)
  @Transform(({ value }) => +value)
  quantity: number;
}

/** `POST /cart/coupon/preview` — valider un code promo pour le panier d'une boutique. */
export class PreviewCartCouponDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011' })
  @IsNotEmpty()
  @IsString()
  storeId: string;

  @ApiProperty({ example: 'BIENVENUE10' })
  @IsNotEmpty()
  @IsString()
  code: string;
}

/** Un code promo à revérifier avant paiement (montant attendu = aperçu précédent). */
export class CheckoutCouponCheckDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  storeId: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  code: string;

  @ApiProperty({
    required: false,
    description:
      'Si fourni, une variation > 0,01 sur la réduction déclenche un avertissement.',
  })
  @IsOptional()
  @IsNumber()
  expectedDiscountAmount?: number;
}

/** `POST /cart/gift-code/preview` — valider un gift code plateforme pour le panier. */
export class PreviewCartGiftCodeDto {
  @ApiProperty({ example: 'WELCOME2026' })
  @IsNotEmpty()
  @IsString()
  code: string;

  @ApiProperty({ type: [CheckoutCouponCheckDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckoutCouponCheckDto)
  coupons?: CheckoutCouponCheckDto[];
}

/** `POST /cart/validate-checkout` — stocks menu du jour / boissons + codes promo. */
export class ValidateCheckoutDto {
  @ApiProperty({ type: [CheckoutCouponCheckDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CheckoutCouponCheckDto)
  coupons?: CheckoutCouponCheckDto[];

  @ApiPropertyOptional({ description: 'Gift code plateforme (aperçu checkout).' })
  @IsOptional()
  @IsString()
  giftCode?: string;

  @ApiPropertyOptional({
    description: 'Montant de réduction gift code attendu (contrôle pré-paiement).',
  })
  @IsOptional()
  @IsNumber()
  expectedGiftCodeDiscountAmount?: number;

  @ApiPropertyOptional({
    description:
      'Pré-commandes impayées existantes par boutique — ignore le contrôle stock menu du jour.',
  })
  @IsOptional()
  @IsObject()
  preOrderOidByStoreId?: Record<string, string>;

  @ApiPropertyOptional({
    description:
      'Boutiques en cours de paiement — limite le contrôle stock à ces boutiques (checkout partiel).',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  checkoutStoreIds?: string[];
}
