import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { UpdateAdNotificationChannelAvailabilityDto } from '@modules/ads/dto/ad-notification.dto';
import { VendorNotificationBillingCyclePeriodEnum } from '@modules/vendor-notifications/vendor-notification-billing-period.util';

export class UpdateRegionAdDiffusionPricingDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  cpmCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cpcCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  campaignCpmCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  campaignCpcCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  campaignActionCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  conversionCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minimumBudgetCad?: number;
}

export class UpdateRegionAdNotificationPricingDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateAdNotificationChannelAvailabilityDto)
  availableChannels?: UpdateAdNotificationChannelAvailabilityDto;

  @IsOptional()
  @IsNumber()
  @Min(0)
  emailDeliveryCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  emailInteractionCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  emailConversionCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pushDeliveryCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pushInteractionCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  pushConversionCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  inAppDeliveryCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  inAppInteractionCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  inAppConversionCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  smsDeliveryCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  smsInteractionCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  smsConversionCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  whatsappDeliveryCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  whatsappInteractionCad?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  whatsappConversionCad?: number;
}

export class UpdateRegionVendorSmsPricingDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  smsUnitCostCad?: number;

  @IsOptional()
  @IsBoolean()
  smsEnabled?: boolean;

  @IsOptional()
  @IsEnum(VendorNotificationBillingCyclePeriodEnum)
  billingCyclePeriod?: VendorNotificationBillingCyclePeriodEnum;
}
