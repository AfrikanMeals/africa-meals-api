import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class PatchPartnerApplicationDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3)
  onboardingStep?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  organizationName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  collaborationNotes?: string;

  @IsOptional()
  @IsBoolean()
  termsAccepted?: boolean;
}

export class RejectPartnerApplicationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  rejectionReason: string;
}

export class SuspendPartnerApplicationDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  suspensionReason?: string;
}
