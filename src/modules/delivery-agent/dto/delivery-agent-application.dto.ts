import { DELIVERY_AGENT_VEHICLE_TYPES } from '@schemas/delivery-agent-vehicle.constants';
import type { DeliveryAgentVehicle } from '@schemas/delivery-agent-vehicle.constants';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PatchDeliveryAgentApplicationDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4)
  onboardingStep?: number;

  @IsOptional()
  @IsIn([...DELIVERY_AGENT_VEHICLE_TYPES])
  vehicle?: DeliveryAgentVehicle;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  vehicleRegistration?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  driverLicense?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  maxConcurrentOrders?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  serviceZone?: string;

  @IsOptional()
  @IsBoolean()
  termsAccepted?: boolean;
}
