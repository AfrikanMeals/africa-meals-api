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
import {
  PlanRegionOrderCommissionDto,
} from './plan-region-order-commission.dto';
import { PlanRegionPricingDto } from './plan-region-pricing.dto';
import { GeocodingEnginePoolEntryDto } from '@modules/map-settings/dto/geocoding-engine-pool-entry.dto';

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

  /** Boutique cible pour une formule personnalisée (admin). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  storeId?: string;

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
  @Max(100)
  recommendationScore?: number;

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
  @IsBoolean()
  storeSubscriptionEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  mealPreOrderEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  pickupPayOnDeliveryEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  marketingToolsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  mapEngineSwitcherEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  mapEngineMapboxEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  mapEngineGoogleEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  mapEngineOsmEnabled?: boolean;

  @IsOptional()
  @IsString()
  vendorGeocodingEngine?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GeocodingEnginePoolEntryDto)
  vendorGeocodingEnginePool?: GeocodingEnginePoolEntryDto[];

  @IsOptional()
  @IsBoolean()
  selfDeliveryEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxDeliveryAgents?: number;

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

  @IsOptional()
  @IsNumber()
  @Min(0)
  initialAdCashGift?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  renewalAdCashGift?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanRegionOrderCommissionDto)
  orderCommissionsByRegion?: PlanRegionOrderCommissionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanRegionOrderCommissionDto)
  payoutFeesByRegion?: PlanRegionOrderCommissionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanRegionPricingDto)
  pricingByRegion?: PlanRegionPricingDto[];
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
  @Max(100)
  recommendationScore?: number;

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
  @IsBoolean()
  storeSubscriptionEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  mealPreOrderEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  pickupPayOnDeliveryEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  marketingToolsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  mapEngineSwitcherEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  mapEngineMapboxEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  mapEngineGoogleEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  mapEngineOsmEnabled?: boolean;

  @IsOptional()
  @IsString()
  vendorGeocodingEngine?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GeocodingEnginePoolEntryDto)
  vendorGeocodingEnginePool?: GeocodingEnginePoolEntryDto[];

  @IsOptional()
  @IsBoolean()
  selfDeliveryEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxDeliveryAgents?: number;

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

  @IsOptional()
  @IsNumber()
  @Min(0)
  initialAdCashGift?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  renewalAdCashGift?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanRegionOrderCommissionDto)
  orderCommissionsByRegion?: PlanRegionOrderCommissionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanRegionOrderCommissionDto)
  payoutFeesByRegion?: PlanRegionOrderCommissionDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanRegionPricingDto)
  pricingByRegion?: PlanRegionPricingDto[];
}

export class SubscribeVendorDto {
  @IsString()
  @MinLength(1)
  planId: string;

  @IsString()
  billingPeriod: 'MONTHLY' | 'YEARLY';

  /** Boutique ciblée (requis si plusieurs boutiques ou formule personnalisée). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  storeId?: string;
}

/** Offre manuelle admin : formule + période personnalisée pour une boutique. */
export class AdminOfferVendorSubscriptionDto {
  @IsString()
  @MinLength(1)
  storeId: string;

  @IsString()
  @MinLength(1)
  planId: string;

  @IsString()
  @MinLength(1)
  startsAt: string;

  @IsString()
  @MinLength(1)
  endsAt: string;

  @IsOptional()
  @IsString()
  billingPeriod?: 'MONTHLY' | 'YEARLY';

  @IsOptional()
  @IsString()
  offerNote?: string;
}
