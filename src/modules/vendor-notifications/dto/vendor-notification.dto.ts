import {
  VENDOR_NOTIFICATION_CATEGORIES,
  VENDOR_NOTIFICATION_CHANNELS,
  type VendorNotificationCategory,
  type VendorNotificationChannelPrefs,
} from '@modules/vendor-notifications/vendor-notification.constants';
import {
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
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
  // NOTE: categories est une map à clés dynamiques (order, delivery, ...).
  // On ne met PAS @Type/@ValidateNested ici : combiné à whitelist:true, cela
  // transformerait la map entière en VendorNotificationChannelPrefsDto et
  // supprimerait toutes les clés de catégorie. La sanitation par catégorie/canal
  // est assurée côté service via normalizeChannelPrefs.
  @IsOptional()
  @IsObject()
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
  const coerce = (
    value: unknown,
    fb: boolean | undefined,
    dflt: boolean,
  ): boolean => (typeof value === 'boolean' ? value : (fb ?? dflt));
  return {
    push: coerce(raw?.push, fallback?.push, true),
    email: coerce(raw?.email, fallback?.email, true),
    sms: coerce(raw?.sms, fallback?.sms, false),
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
