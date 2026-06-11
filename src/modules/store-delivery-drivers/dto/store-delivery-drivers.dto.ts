import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StoreDeliveryAssignmentModeEnum } from '@schemas/store.schema';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class InviteStoreDeliveryDriverDto {
  @ApiProperty({ example: 'livreur@example.com' })
  @IsNotEmpty()
  @IsEmail()
  email: string;
}

export class AcceptStoreDeliveryDriverInviteDto {
  @ApiProperty({ description: 'Jeton reçu par courriel' })
  @IsNotEmpty()
  @IsString()
  token: string;
}

export class StoreDeliveryDriverRowDto {
  id: string;
  email: string;
  userId?: string;
  fullName?: string;
  phoneNumber?: string;
  status: string;
  invitedAt?: string;
  respondedAt?: string;
  ordersDelivered: number;
  ordersDeliveredToday: number;
  deliveryRevenueTotal: number;
  deliveryRevenueToday: number;
}

export class StoreDeliveryDriversListResponseDto {
  storeId: string;
  storeName: string;
  vendorManagesDeliveryDrivers: boolean;
  deliveryAssignmentMode: StoreDeliveryAssignmentModeEnum;
  items: StoreDeliveryDriverRowDto[];
}
