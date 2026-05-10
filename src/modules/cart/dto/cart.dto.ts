import { CartItemModel, CartItemTypeEnum } from '@schemas/cart_item.schema';
import { StoreModel } from '@schemas/store.schema';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

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

  @ApiProperty({ example: '507f1f77bcf86cd799439012', description: 'Requis si type = PRODUCT_EXTRA' })
  @IsNotEmpty()
  @ValidateIf((o) => o.type === CartItemTypeEnum.PRODUCT_EXTRA)
  productId: string;
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

/** `POST /cart/coupon/preview` — valider un code promo pour le panier d’une boutique. */
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
