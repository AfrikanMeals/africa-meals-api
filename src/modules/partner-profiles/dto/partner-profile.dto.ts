import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PartnerAccountType } from '@schemas/partner-profile.schema';

export class PatchPartnerProfileDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  onboardingStep?: number;

  @IsOptional()
  @IsEnum(PartnerAccountType)
  accountType?: PartnerAccountType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  individualName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  taxNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  addressLatitude?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  addressLongitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  facebookUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  tiktokUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  instagramUrl?: string;

  @IsOptional()
  @IsBoolean()
  policyAccepted?: boolean;
}

export class RejectPartnerProfileDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  rejectionReason: string;
}

export class SuspendPartnerProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  suspensionReason?: string;
}

/** Admin — code parrainage custom (optionnel) ; vide = auto-génération. */
export class EnsurePartnerReferralCodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(6)
  referralCode?: string;
}
