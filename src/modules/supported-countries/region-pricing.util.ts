import type { AdNotificationChannelAvailability } from '@modules/ads/ad-notification-channel-availability.util';
import { parseAvailableChannelsFromDoc } from '@modules/ads/ad-notification-channel-availability.util';
import {
  normalizeBillingCyclePeriod,
  VendorNotificationBillingCyclePeriodEnum,
} from '@modules/vendor-notifications/vendor-notification-billing-period.util';
import type { RegionAdDiffusionPricingModel } from '@schemas/region-pricing.schema';
import type { RegionAdNotificationPricingModel } from '@schemas/region-pricing.schema';
import type { RegionVendorSmsPricingModel } from '@schemas/region-pricing.schema';
import type { AdNotificationPricingSettingsModel } from '@schemas/ad-notification-pricing-settings.schema';
import type { AdPricingSettingsModel } from '@schemas/ad-pricing-settings.schema';
import type { VendorNotificationPricingSettingsModel } from '@schemas/vendor-notification-pricing-settings.schema';

export type RegionAdDiffusionPricingPayload = {
  regionCode: string;
  currency: string;
  cpmCad: number;
  cpcCad: number;
  campaignCpmCad: number;
  campaignCpcCad: number;
  campaignActionCad: number;
  conversionCad: number;
  minimumBudgetCad: number;
  configuredOnRegion: boolean;
};

export type RegionAdNotificationPricingPayload = {
  regionCode: string;
  currency: string;
  availableChannels: AdNotificationChannelAvailability;
  emailDeliveryCad: number;
  emailInteractionCad: number;
  emailConversionCad: number;
  pushDeliveryCad: number;
  pushInteractionCad: number;
  pushConversionCad: number;
  inAppDeliveryCad: number;
  inAppInteractionCad: number;
  inAppConversionCad: number;
  smsDeliveryCad: number;
  smsInteractionCad: number;
  smsConversionCad: number;
  whatsappDeliveryCad: number;
  whatsappInteractionCad: number;
  whatsappConversionCad: number;
  configuredOnRegion: boolean;
};

export type RegionVendorSmsPricingPayload = {
  regionCode: string;
  currency: string;
  smsUnitCostCad: number;
  smsEnabled: boolean;
  billingCyclePeriod: VendorNotificationBillingCyclePeriodEnum;
  configuredOnRegion: boolean;
};

function nonNegativeNumber(value: unknown, fallback = 0): number {
  const x = Number(value ?? fallback);
  return Number.isFinite(x) && x >= 0 ? x : fallback >= 0 ? fallback : 0;
}

function normalizeRegionCode(raw?: string | null): string | null {
  const code = String(raw ?? '')
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function globalAdDiffusionFromDoc(
  doc: AdPricingSettingsModel | null | undefined,
  currency: string,
): Omit<RegionAdDiffusionPricingPayload, 'regionCode' | 'configuredOnRegion'> {
  return {
    currency,
    cpmCad: nonNegativeNumber(doc?.cpmCad),
    cpcCad: nonNegativeNumber(doc?.cpcCad),
    campaignCpmCad: nonNegativeNumber(doc?.campaignCpmCad),
    campaignCpcCad: nonNegativeNumber(doc?.campaignCpcCad),
    campaignActionCad: nonNegativeNumber(doc?.campaignActionCad),
    conversionCad: nonNegativeNumber(doc?.conversionCad),
    minimumBudgetCad: nonNegativeNumber(doc?.minimumBudgetCad),
  };
}

export function globalAdNotificationFromDoc(
  doc: AdNotificationPricingSettingsModel | null | undefined,
  currency: string,
): Omit<RegionAdNotificationPricingPayload, 'regionCode' | 'configuredOnRegion'> {
  const n = (v: unknown) => nonNegativeNumber(v);
  return {
    currency,
    availableChannels: parseAvailableChannelsFromDoc(
      doc as unknown as Record<string, unknown> | null | undefined,
    ),
    emailDeliveryCad: n(doc?.emailDeliveryCad),
    emailInteractionCad: n(doc?.emailInteractionCad),
    emailConversionCad: n(doc?.emailConversionCad),
    pushDeliveryCad: n(doc?.pushDeliveryCad),
    pushInteractionCad: n(doc?.pushInteractionCad),
    pushConversionCad: n(doc?.pushConversionCad),
    inAppDeliveryCad: n(doc?.inAppDeliveryCad),
    inAppInteractionCad: n(doc?.inAppInteractionCad),
    inAppConversionCad: n(doc?.inAppConversionCad),
    smsDeliveryCad: n(doc?.smsDeliveryCad),
    smsInteractionCad: n(doc?.smsInteractionCad),
    smsConversionCad: n(doc?.smsConversionCad),
    whatsappDeliveryCad: n(doc?.whatsappDeliveryCad),
    whatsappInteractionCad: n(doc?.whatsappInteractionCad),
    whatsappConversionCad: n(doc?.whatsappConversionCad),
  };
}

export function globalVendorSmsFromDoc(
  doc: VendorNotificationPricingSettingsModel | null | undefined,
  currency: string,
): Omit<RegionVendorSmsPricingPayload, 'regionCode' | 'configuredOnRegion'> {
  return {
    currency,
    smsUnitCostCad: nonNegativeNumber(doc?.smsUnitCostCad, 0.08),
    smsEnabled: doc?.smsEnabled !== false,
    billingCyclePeriod: normalizeBillingCyclePeriod(doc?.billingCyclePeriod),
  };
}

function pickNumber(
  regional: number | null | undefined,
  global: number,
): number {
  if (regional != null && Number.isFinite(Number(regional))) {
    return nonNegativeNumber(regional, global);
  }
  return global;
}

export function mergeAdDiffusionPricing(
  regionCode: string,
  currency: string,
  global: Omit<RegionAdDiffusionPricingPayload, 'regionCode' | 'configuredOnRegion'>,
  regional?: RegionAdDiffusionPricingModel | null,
): RegionAdDiffusionPricingPayload {
  const configuredOnRegion = regional != null;
  if (!regional) {
    return { regionCode, configuredOnRegion: false, ...global };
  }
  return {
    regionCode,
    currency,
    configuredOnRegion,
    cpmCad: pickNumber(regional.cpm, global.cpmCad),
    cpcCad: pickNumber(regional.cpc, global.cpcCad),
    campaignCpmCad: pickNumber(regional.campaignCpm, global.campaignCpmCad),
    campaignCpcCad: pickNumber(regional.campaignCpc, global.campaignCpcCad),
    campaignActionCad: pickNumber(regional.campaignAction, global.campaignActionCad),
    conversionCad: pickNumber(regional.conversion, global.conversionCad),
    minimumBudgetCad: pickNumber(regional.minimumBudget, global.minimumBudgetCad),
  };
}

export function mergeAdNotificationPricing(
  regionCode: string,
  currency: string,
  global: Omit<RegionAdNotificationPricingPayload, 'regionCode' | 'configuredOnRegion'>,
  regional?: RegionAdNotificationPricingModel | null,
): RegionAdNotificationPricingPayload {
  const configuredOnRegion = regional != null;
  if (!regional) {
    return { regionCode, configuredOnRegion: false, ...global };
  }
  const availableChannels =
    regional.availableChannels != null
      ? parseAvailableChannelsFromDoc({
          availableChannels: regional.availableChannels as unknown as Record<
            string,
            unknown
          >,
        })
      : global.availableChannels;
  return {
    regionCode,
    currency,
    configuredOnRegion,
    availableChannels,
    emailDeliveryCad: pickNumber(regional.emailDelivery, global.emailDeliveryCad),
    emailInteractionCad: pickNumber(
      regional.emailInteraction,
      global.emailInteractionCad,
    ),
    emailConversionCad: pickNumber(
      regional.emailConversion,
      global.emailConversionCad,
    ),
    pushDeliveryCad: pickNumber(regional.pushDelivery, global.pushDeliveryCad),
    pushInteractionCad: pickNumber(
      regional.pushInteraction,
      global.pushInteractionCad,
    ),
    pushConversionCad: pickNumber(regional.pushConversion, global.pushConversionCad),
    inAppDeliveryCad: pickNumber(regional.inAppDelivery, global.inAppDeliveryCad),
    inAppInteractionCad: pickNumber(
      regional.inAppInteraction,
      global.inAppInteractionCad,
    ),
    inAppConversionCad: pickNumber(
      regional.inAppConversion,
      global.inAppConversionCad,
    ),
    smsDeliveryCad: pickNumber(regional.smsDelivery, global.smsDeliveryCad),
    smsInteractionCad: pickNumber(regional.smsInteraction, global.smsInteractionCad),
    smsConversionCad: pickNumber(regional.smsConversion, global.smsConversionCad),
    whatsappDeliveryCad: pickNumber(
      regional.whatsappDelivery,
      global.whatsappDeliveryCad,
    ),
    whatsappInteractionCad: pickNumber(
      regional.whatsappInteraction,
      global.whatsappInteractionCad,
    ),
    whatsappConversionCad: pickNumber(
      regional.whatsappConversion,
      global.whatsappConversionCad,
    ),
  };
}

export function mergeVendorSmsPricing(
  regionCode: string,
  currency: string,
  global: Omit<RegionVendorSmsPricingPayload, 'regionCode' | 'configuredOnRegion'>,
  regional?: RegionVendorSmsPricingModel | null,
): RegionVendorSmsPricingPayload {
  const configuredOnRegion = regional != null;
  if (!regional) {
    return { regionCode, configuredOnRegion: false, ...global };
  }
  return {
    regionCode,
    currency,
    configuredOnRegion,
    smsUnitCostCad: pickNumber(regional.smsUnitCost, global.smsUnitCostCad),
    smsEnabled:
      regional.smsEnabled != null ? regional.smsEnabled !== false : global.smsEnabled,
    billingCyclePeriod:
      regional.billingCyclePeriod != null
        ? normalizeBillingCyclePeriod(regional.billingCyclePeriod)
        : global.billingCyclePeriod,
  };
}

export function toRegionAdDiffusionDoc(
  payload: Partial<RegionAdDiffusionPricingPayload>,
): RegionAdDiffusionPricingModel {
  return {
    cpm: nonNegativeNumber(payload.cpmCad),
    cpc: nonNegativeNumber(payload.cpcCad),
    campaignCpm: nonNegativeNumber(payload.campaignCpmCad),
    campaignCpc: nonNegativeNumber(payload.campaignCpcCad),
    campaignAction: nonNegativeNumber(payload.campaignActionCad),
    conversion: nonNegativeNumber(payload.conversionCad),
    minimumBudget: nonNegativeNumber(payload.minimumBudgetCad),
  };
}

export function toRegionAdNotificationDoc(
  payload: Partial<RegionAdNotificationPricingPayload>,
): RegionAdNotificationPricingModel {
  const channels = payload.availableChannels;
  return {
    availableChannels: channels
      ? {
          email: channels.email === true,
          push: channels.push === true,
          inApp: channels.inApp === true,
          sms: channels.sms === true,
          whatsapp: channels.whatsapp === true,
        }
      : null,
    emailDelivery: nonNegativeNumber(payload.emailDeliveryCad),
    emailInteraction: nonNegativeNumber(payload.emailInteractionCad),
    emailConversion: nonNegativeNumber(payload.emailConversionCad),
    pushDelivery: nonNegativeNumber(payload.pushDeliveryCad),
    pushInteraction: nonNegativeNumber(payload.pushInteractionCad),
    pushConversion: nonNegativeNumber(payload.pushConversionCad),
    inAppDelivery: nonNegativeNumber(payload.inAppDeliveryCad),
    inAppInteraction: nonNegativeNumber(payload.inAppInteractionCad),
    inAppConversion: nonNegativeNumber(payload.inAppConversionCad),
    smsDelivery: nonNegativeNumber(payload.smsDeliveryCad),
    smsInteraction: nonNegativeNumber(payload.smsInteractionCad),
    smsConversion: nonNegativeNumber(payload.smsConversionCad),
    whatsappDelivery: nonNegativeNumber(payload.whatsappDeliveryCad),
    whatsappInteraction: nonNegativeNumber(payload.whatsappInteractionCad),
    whatsappConversion: nonNegativeNumber(payload.whatsappConversionCad),
  };
}

export function toRegionVendorSmsDoc(
  payload: Partial<RegionVendorSmsPricingPayload>,
): RegionVendorSmsPricingModel {
  return {
    smsUnitCost: nonNegativeNumber(payload.smsUnitCostCad, 0.08),
    smsEnabled: payload.smsEnabled !== false,
    billingCyclePeriod: normalizeBillingCyclePeriod(payload.billingCyclePeriod),
  };
}

export { normalizeRegionCode };
