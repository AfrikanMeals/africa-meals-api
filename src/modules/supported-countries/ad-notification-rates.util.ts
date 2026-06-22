import type { AdNotificationPricingSettingsModel } from '@schemas/ad-notification-pricing-settings.schema';
import type { RegionAdNotificationChannelRatesModel } from '@schemas/region-pricing.schema';

export type AdNotificationChannelRatesCad = {
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
};

export type AdNotificationPricingKind = 'banner' | 'campaign';

export const AD_NOTIFICATION_RATE_FIELD_KEYS = [
  'emailDeliveryCad',
  'emailInteractionCad',
  'emailConversionCad',
  'pushDeliveryCad',
  'pushInteractionCad',
  'pushConversionCad',
  'inAppDeliveryCad',
  'inAppInteractionCad',
  'inAppConversionCad',
  'smsDeliveryCad',
  'smsInteractionCad',
  'smsConversionCad',
  'whatsappDeliveryCad',
  'whatsappInteractionCad',
  'whatsappConversionCad',
] as const satisfies ReadonlyArray<keyof AdNotificationChannelRatesCad>;

function nonNegativeNumber(value: unknown, fallback = 0): number {
  const x = Number(value ?? fallback);
  return Number.isFinite(x) && x >= 0 ? x : fallback >= 0 ? fallback : 0;
}

export function emptyAdNotificationChannelRatesCad(): AdNotificationChannelRatesCad {
  return {
    emailDeliveryCad: 0,
    emailInteractionCad: 0,
    emailConversionCad: 0,
    pushDeliveryCad: 0,
    pushInteractionCad: 0,
    pushConversionCad: 0,
    inAppDeliveryCad: 0,
    inAppInteractionCad: 0,
    inAppConversionCad: 0,
    smsDeliveryCad: 0,
    smsInteractionCad: 0,
    smsConversionCad: 0,
    whatsappDeliveryCad: 0,
    whatsappInteractionCad: 0,
    whatsappConversionCad: 0,
  };
}

export function adNotificationRatesFromGlobalContextDoc(
  doc:
    | {
        emailDeliveryCad?: number;
        emailInteractionCad?: number;
        emailConversionCad?: number;
        pushDeliveryCad?: number;
        pushInteractionCad?: number;
        pushConversionCad?: number;
        inAppDeliveryCad?: number;
        inAppInteractionCad?: number;
        inAppConversionCad?: number;
        smsDeliveryCad?: number;
        smsInteractionCad?: number;
        smsConversionCad?: number;
        whatsappDeliveryCad?: number;
        whatsappInteractionCad?: number;
        whatsappConversionCad?: number;
      }
    | null
    | undefined,
  fallback: AdNotificationChannelRatesCad,
): AdNotificationChannelRatesCad {
  if (!doc) return { ...fallback };
  const n = (v: unknown, fb: number) => nonNegativeNumber(v, fb);
  return {
    emailDeliveryCad: n(doc.emailDeliveryCad, fallback.emailDeliveryCad),
    emailInteractionCad: n(doc.emailInteractionCad, fallback.emailInteractionCad),
    emailConversionCad: n(doc.emailConversionCad, fallback.emailConversionCad),
    pushDeliveryCad: n(doc.pushDeliveryCad, fallback.pushDeliveryCad),
    pushInteractionCad: n(doc.pushInteractionCad, fallback.pushInteractionCad),
    pushConversionCad: n(doc.pushConversionCad, fallback.pushConversionCad),
    inAppDeliveryCad: n(doc.inAppDeliveryCad, fallback.inAppDeliveryCad),
    inAppInteractionCad: n(doc.inAppInteractionCad, fallback.inAppInteractionCad),
    inAppConversionCad: n(doc.inAppConversionCad, fallback.inAppConversionCad),
    smsDeliveryCad: n(doc.smsDeliveryCad, fallback.smsDeliveryCad),
    smsInteractionCad: n(doc.smsInteractionCad, fallback.smsInteractionCad),
    smsConversionCad: n(doc.smsConversionCad, fallback.smsConversionCad),
    whatsappDeliveryCad: n(doc.whatsappDeliveryCad, fallback.whatsappDeliveryCad),
    whatsappInteractionCad: n(
      doc.whatsappInteractionCad,
      fallback.whatsappInteractionCad,
    ),
    whatsappConversionCad: n(doc.whatsappConversionCad, fallback.whatsappConversionCad),
  };
}

export function adNotificationRatesFromRegionalChannelDoc(
  doc: RegionAdNotificationChannelRatesModel | null | undefined,
  fallback: AdNotificationChannelRatesCad,
): AdNotificationChannelRatesCad {
  if (!doc) return { ...fallback };
  const n = (v: unknown, fb: number) =>
    v != null && Number.isFinite(Number(v))
      ? nonNegativeNumber(v, fb)
      : fb;
  return {
    emailDeliveryCad: n(doc.emailDelivery, fallback.emailDeliveryCad),
    emailInteractionCad: n(doc.emailInteraction, fallback.emailInteractionCad),
    emailConversionCad: n(doc.emailConversion, fallback.emailConversionCad),
    pushDeliveryCad: n(doc.pushDelivery, fallback.pushDeliveryCad),
    pushInteractionCad: n(doc.pushInteraction, fallback.pushInteractionCad),
    pushConversionCad: n(doc.pushConversion, fallback.pushConversionCad),
    inAppDeliveryCad: n(doc.inAppDelivery, fallback.inAppDeliveryCad),
    inAppInteractionCad: n(doc.inAppInteraction, fallback.inAppInteractionCad),
    inAppConversionCad: n(doc.inAppConversion, fallback.inAppConversionCad),
    smsDeliveryCad: n(doc.smsDelivery, fallback.smsDeliveryCad),
    smsInteractionCad: n(doc.smsInteraction, fallback.smsInteractionCad),
    smsConversionCad: n(doc.smsConversion, fallback.smsConversionCad),
    whatsappDeliveryCad: n(doc.whatsappDelivery, fallback.whatsappDeliveryCad),
    whatsappInteractionCad: n(doc.whatsappInteraction, fallback.whatsappInteractionCad),
    whatsappConversionCad: n(doc.whatsappConversion, fallback.whatsappConversionCad),
  };
}

export function adNotificationLegacyFlatFromGlobalDoc(
  doc: AdNotificationPricingSettingsModel | null | undefined,
): AdNotificationChannelRatesCad {
  const n = (v: unknown) => nonNegativeNumber(v);
  return {
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

export function adNotificationLegacyFlatFromRegionalDoc(
  doc: RegionAdNotificationChannelRatesModel | null | undefined,
  fallback: AdNotificationChannelRatesCad,
): AdNotificationChannelRatesCad {
  return adNotificationRatesFromRegionalChannelDoc(doc, fallback);
}

export function adNotificationRegionalLegacyFlat(
  regional: {
    emailDelivery?: number | null;
    emailInteraction?: number | null;
    emailConversion?: number | null;
    pushDelivery?: number | null;
    pushInteraction?: number | null;
    pushConversion?: number | null;
    inAppDelivery?: number | null;
    inAppInteraction?: number | null;
    inAppConversion?: number | null;
    smsDelivery?: number | null;
    smsInteraction?: number | null;
    smsConversion?: number | null;
    whatsappDelivery?: number | null;
    whatsappInteraction?: number | null;
    whatsappConversion?: number | null;
  } | null | undefined,
  fallback: AdNotificationChannelRatesCad,
): AdNotificationChannelRatesCad {
  if (!regional) return { ...fallback };
  return adNotificationRatesFromRegionalChannelDoc(
    regional as RegionAdNotificationChannelRatesModel,
    fallback,
  );
}

export function toRegionalChannelRatesDoc(
  rates: AdNotificationChannelRatesCad,
): RegionAdNotificationChannelRatesModel {
  return {
    emailDelivery: rates.emailDeliveryCad,
    emailInteraction: rates.emailInteractionCad,
    emailConversion: rates.emailConversionCad,
    pushDelivery: rates.pushDeliveryCad,
    pushInteraction: rates.pushInteractionCad,
    pushConversion: rates.pushConversionCad,
    inAppDelivery: rates.inAppDeliveryCad,
    inAppInteraction: rates.inAppInteractionCad,
    inAppConversion: rates.inAppConversionCad,
    smsDelivery: rates.smsDeliveryCad,
    smsInteraction: rates.smsInteractionCad,
    smsConversion: rates.smsConversionCad,
    whatsappDelivery: rates.whatsappDeliveryCad,
    whatsappInteraction: rates.whatsappInteractionCad,
    whatsappConversion: rates.whatsappConversionCad,
  };
}

export function toGlobalContextRatesDoc(
  rates: AdNotificationChannelRatesCad,
): AdNotificationPricingSettingsModel['bannerRates'] {
  return { ...rates };
}

export function pickAdNotificationRatesForKind(
  payload: {
    banner: AdNotificationChannelRatesCad;
    campaign: AdNotificationChannelRatesCad;
  },
  kind: AdNotificationPricingKind,
): AdNotificationChannelRatesCad {
  return kind === 'campaign' ? payload.campaign : payload.banner;
}

export function extractAdNotificationRatesFromDto(
  dto: Record<string, unknown>,
): Partial<AdNotificationChannelRatesCad> {
  const out: Partial<AdNotificationChannelRatesCad> = {};
  for (const key of AD_NOTIFICATION_RATE_FIELD_KEYS) {
    if (dto[key] != null) {
      out[key] = nonNegativeNumber(dto[key]);
    }
  }
  return out;
}

export function mergeAdNotificationRatesPartial(
  base: AdNotificationChannelRatesCad,
  patch: Partial<AdNotificationChannelRatesCad>,
): AdNotificationChannelRatesCad {
  return { ...base, ...patch };
}
