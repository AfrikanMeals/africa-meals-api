import { CartItemModel, CartItemTypeEnum } from '@schemas/cart_item.schema';
import { StoreModel } from '@schemas/store.schema';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNumber, Min, ValidateIf } from 'class-validator';

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

  // @IsNotEmpty()
  // storeId: string;

  @IsNotEmpty()
  itemId: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => +value)
  quantity: number;

  @IsNotEmpty()
  @IsNumber()
  @Transform(({ value }) => +value)
  price: number;

  @IsNotEmpty()
  @ValidateIf((o) => o.type === CartItemTypeEnum.PRODUCT_EXTRA)
  productId: string;
}

export class CartItemApiResponse {
  store: StoreModel;
  items: Partial<CartItemModel>[];
  totalPrice: number;
}
