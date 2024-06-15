import { CartItemTypeEnum } from '@schemas/cart_item.schema';
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
