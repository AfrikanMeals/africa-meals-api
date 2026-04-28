import { IsMongoId, IsNotEmpty, IsString } from 'class-validator';

export class AssignDashboardOrderDto {
  @IsString()
  @IsNotEmpty()
  @IsMongoId()
  livreurId: string;

  @IsString()
  @IsNotEmpty()
  @IsMongoId()
  orderId: string;
}
