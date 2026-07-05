import { IsMongoId, IsNotEmpty, IsString } from 'class-validator';

export class UnassignDashboardOrderDto {
  @IsString()
  @IsNotEmpty()
  @IsMongoId()
  orderId: string;
}
