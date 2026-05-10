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
  @Max(3)
  onboardingStep?: number;

  @IsOptional()
  @IsIn(['moto', 'velo', 'voiture'])
  vehicle?: 'moto' | 'velo' | 'voiture';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  serviceZone?: string;

  @IsOptional()
  @IsBoolean()
  termsAccepted?: boolean;
}
