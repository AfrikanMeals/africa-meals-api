import {
  VENDOR_NOTIFICATION_CATEGORIES,
  VENDOR_NOTIFICATION_CHANNELS,
  type VendorNotificationCategory,
  type VendorNotificationChannelPrefs,
} from '@modules/vendor-notifications/vendor-notification.constants';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class VendorNotificationChannelPrefsDto {
  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @IsOptional()
  @IsBoolean()
  sms?: boolean;
}

export class UpdateVendorNotificationPreferencesDto {
  @IsOptional()
  @IsObject()
  @ValidateNested({ each: true })
  @Type(() => VendorNotificationChannelPrefsDto)
  categories?: Partial<
    Record<VendorNotificationCategory, VendorNotificationChannelPrefsDto>
  >;
}

export class UpdateVendorNotificationPricingDto {
  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  smsUnitCostCad?: number;

  @IsOptional()
  @IsBoolean()
  smsEnabled?: boolean;
}

export class VendorNotificationStatsQueryDto {
  @IsOptional()
  @IsString()
  storeId?: string;

  @IsOptional()
  @IsString()
  billingMonth?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

export function normalizeChannelPrefs(
  raw?: VendorNotificationChannelPrefsDto | null,
  fallback?: VendorNotificationChannelPrefs,
): VendorNotificationChannelPrefs {
  return {
    push: raw?.push ?? fallback?.push ?? true,
    email: raw?.email ?? fallback?.email ?? true,
    sms: raw?.sms ?? fallback?.sms ?? false,
  };
}

export function isVendorNotificationCategory(
  value: string,
): value is VendorNotificationCategory {
  return (VENDOR_NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}

export function isVendorNotificationChannel(
  value: string,
): value is (typeof VENDOR_NOTIFICATION_CHANNELS)[number] {
  return (VENDOR_NOTIFICATION_CHANNELS as readonly string[]).includes(value);
}
