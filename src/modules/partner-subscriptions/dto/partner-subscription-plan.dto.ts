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
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PlanRegionOrderCommissionDto } from '@modules/subscriptions/dto/plan-region-order-commission.dto';
import { PlanRegionPricingDto } from '@modules/subscriptions/dto/plan-region-pricing.dto';

export class CreatePartnerSubscriptionPlanDto {
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

  /** 0 = versement instantané ; 1–30 = délai calendrier Stripe (jours). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  payoutDelayDays?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(90, { each: true })
  trialReminderDays?: number[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanRegionPricingDto)
  pricingByRegion?: PlanRegionPricingDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanRegionOrderCommissionDto)
  customerOrderCommissionsByRegion?: PlanRegionOrderCommissionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanRegionOrderCommissionDto)
  vendorSalesCommissionsByRegion?: PlanRegionOrderCommissionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanRegionOrderCommissionDto)
  courierGainsCommissionsByRegion?: PlanRegionOrderCommissionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanRegionOrderCommissionDto)
  payoutFeesByRegion?: PlanRegionOrderCommissionDto[];
}

export class UpdatePartnerSubscriptionPlanDto {
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

  /** 0 = versement instantané ; 1–30 = délai calendrier Stripe (jours). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  payoutDelayDays?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(90, { each: true })
  trialReminderDays?: number[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanRegionPricingDto)
  pricingByRegion?: PlanRegionPricingDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanRegionOrderCommissionDto)
  customerOrderCommissionsByRegion?: PlanRegionOrderCommissionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanRegionOrderCommissionDto)
  vendorSalesCommissionsByRegion?: PlanRegionOrderCommissionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanRegionOrderCommissionDto)
  courierGainsCommissionsByRegion?: PlanRegionOrderCommissionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanRegionOrderCommissionDto)
  payoutFeesByRegion?: PlanRegionOrderCommissionDto[];
}

export class SubscribePartnerDto {
  @IsString()
  @MinLength(1)
  planId: string;

  @IsOptional()
  @IsString()
  billingPeriod?: 'MONTHLY' | 'YEARLY';

  @IsOptional()
  @IsString()
  regionCode?: string;
}

export class StartPartnerTrialDto {
  @IsString()
  @MinLength(1)
  planId: string;

  @IsOptional()
  @IsString()
  regionCode?: string;
}

export class AttachPartnerReferralDto {
  @IsString()
  @MinLength(3)
  referralCode: string;
}

/** Sync après Payment Sheet mobile (PaymentIntent). */
export class SyncPartnerPaymentDto {
  @IsString()
  @MinLength(3)
  paymentIntentId: string;
}
