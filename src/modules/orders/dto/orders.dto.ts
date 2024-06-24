import { OrderStatusEnum } from '@schemas/order.schema';
import { IsEnum, IsOptional } from 'class-validator';

export class FilterOrdersDto {
  @IsOptional()
  @IsEnum(OrderStatusEnum)
  status?: OrderStatusEnum;

  @IsOptional()
  storeId?: string;
}
