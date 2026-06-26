import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdatePlatformLegalSettingsDto {
  @ApiPropertyOptional({ example: 'SenTech' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  companyLegalName?: string;

  @ApiPropertyOptional({ example: 'Wise Eat' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  tradeName?: string;

  @ApiPropertyOptional({ example: 'https://wise-eat.com' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  websiteUrl?: string;

  @ApiPropertyOptional({ example: 'help@wise-eat.com' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  supportEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  privacyEmail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalEmail?: string;

  @ApiPropertyOptional({ example: 'Montréal, Québec, Canada' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  registeredAddress?: string;

  @ApiPropertyOptional({ example: 'Canada' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  jurisdictionCountry?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  governingLawFr?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  governingLawEn?: string;

  @ApiPropertyOptional({ example: 16 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(13)
  @Max(21)
  minimumAge?: number;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(365)
  accountDeletionGraceDays?: number;

  @ApiPropertyOptional({ example: 'Stripe, PayPal' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  paymentProvidersFr?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  paymentProvidersEn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  mapProvidersFr?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  mapProvidersEn?: string;

  @ApiPropertyOptional({ example: '2026-06-26' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  lastUpdatedLabel?: string;

  @ApiPropertyOptional({ example: '/privacy' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  privacyPath?: string;

  @ApiPropertyOptional({ example: '/terms' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  termsPath?: string;

  @ApiPropertyOptional({ example: '/policy' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  policyIndexPath?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  contactPath?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  statusPath?: string;
}
