import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class CreateSubscriptionPlanDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  priceMonthly: number;

  @IsNumber()
  @Min(0)
  priceYearly: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  trialDays?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(90, { each: true })
  trialReminderDays?: number[];

  @IsOptional()
  @IsInt()
  @Min(0)
  maxStores?: number;

  @IsOptional()
  @IsBoolean()
  mobileAccess?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxCatalogItems?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxDailyMenuItems?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxAdCampaignItems?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxActiveBanners?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxActiveCampaigns?: number;
}

export class UpdateSubscriptionPlanDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceMonthly?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceYearly?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsNumber()
  sortOrder?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  trialDays?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(90, { each: true })
  trialReminderDays?: number[];

  @IsOptional()
  @IsInt()
  @Min(0)
  maxStores?: number;

  @IsOptional()
  @IsBoolean()
  mobileAccess?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxCatalogItems?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxDailyMenuItems?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxAdCampaignItems?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxActiveBanners?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxActiveCampaigns?: number;
}

export class SubscribeVendorDto {
  @IsString()
  @MinLength(1)
  planId: string;

  @IsString()
  billingPeriod: 'MONTHLY' | 'YEARLY';
}
