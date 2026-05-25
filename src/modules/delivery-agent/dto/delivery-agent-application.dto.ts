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
  @IsIn(['moto', 'velo', 'voiture'])
  vehicle?: 'moto' | 'velo' | 'voiture';

  @IsOptional()
  @IsString()
  @MaxLength(32)
  vehicleRegistration?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  maxConcurrentOrders?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  serviceZone?: string;

  @IsOptional()
  @IsBoolean()
  termsAccepted?: boolean;
}
