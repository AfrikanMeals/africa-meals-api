import { IsMongoId, IsNotEmpty, IsString } from 'class-validator';

export class AssignDashboardOrderDto {
  /** Id Mongo de l’utilisateur (`users`, type DELIVERY). Legacy : `dlusr_<userId>`. */
  @IsString()
  @IsNotEmpty()
  livreurId: string;

  @IsString()
  @IsNotEmpty()
  @IsMongoId()
  orderId: string;
}
