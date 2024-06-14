import { CartItemTypeEnum } from '@schemas/cart_item.schema';
import { IsEnum, IsNotEmpty, ValidateIf } from 'class-validator';

export class RemoveItemFromCartDto {
  @IsNotEmpty()
  itemId: string;

  @IsNotEmpty()
  @IsEnum(CartItemTypeEnum)
  type: CartItemTypeEnum;
}

export class AddItemToCartDto {
  @IsNotEmpty()
  @IsEnum(CartItemTypeEnum)
  type: CartItemTypeEnum;

  @IsNotEmpty()
  itemId: string;

  @IsNotEmpty()
  quantity: number;

  @IsNotEmpty()
  price: number;

  @IsNotEmpty()
  @ValidateIf((o) => o.type === CartItemTypeEnum.PRODUCT_EXTRA)
  productId: string;
}
