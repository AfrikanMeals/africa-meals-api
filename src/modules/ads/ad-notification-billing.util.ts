export type AdNotificationChannelKey =
  | 'email'
  | 'push'
  | 'inApp'
  | 'sms'
  | 'whatsapp';

export type AdNotificationPricingRates = {
  currency: string;
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
};

export type AdNotificationBillingMetrics = {
  byChannel: Record<
    AdNotificationChannelKey,
    { deliveries: number; interactions: number; conversions: number }
  >;
  totalDeliveries: number;
  totalInteractions: number;
  totalConversions: number;
};

const CHANNELS: AdNotificationChannelKey[] = [
  'email',
  'push',
  'inApp',
  'sms',
  'whatsapp',
];

function emptyMetrics(): AdNotificationBillingMetrics['byChannel'] {
  return {
    email: { deliveries: 0, interactions: 0, conversions: 0 },
    push: { deliveries: 0, interactions: 0, conversions: 0 },
    inApp: { deliveries: 0, interactions: 0, conversions: 0 },
    sms: { deliveries: 0, interactions: 0, conversions: 0 },
    whatsapp: { deliveries: 0, interactions: 0, conversions: 0 },
  };
}

function channelPrefix(ch: AdNotificationChannelKey): string {
  return ch === 'inApp' ? 'inApp' : ch;
}

export function buildEmptyNotificationBillingMetrics(): AdNotificationBillingMetrics {
  const byChannel = emptyMetrics();
  return {
    byChannel,
    totalDeliveries: 0,
    totalInteractions: 0,
    totalConversions: 0,
  };
}

export function aggregateNotificationBillingMetrics(
  rows: Array<{
    channel: AdNotificationChannelKey;
    deliveries: number;
    interactions: number;
    conversions: number;
  }>,
): AdNotificationBillingMetrics {
  const byChannel = emptyMetrics();
  for (const row of rows) {
    const slot = byChannel[row.channel];
    if (!slot) continue;
    slot.deliveries += row.deliveries;
    slot.interactions += row.interactions;
    slot.conversions += row.conversions;
  }
  let totalDeliveries = 0;
  let totalInteractions = 0;
  let totalConversions = 0;
  for (const ch of CHANNELS) {
    totalDeliveries += byChannel[ch].deliveries;
    totalInteractions += byChannel[ch].interactions;
    totalConversions += byChannel[ch].conversions;
  }
  return {
    byChannel,
    totalDeliveries,
    totalInteractions,
    totalConversions,
  };
}

export function computeNotificationBillingAmountCad(
  metrics: AdNotificationBillingMetrics,
  pricing: AdNotificationPricingRates,
): number {
  let total = 0;
  for (const ch of CHANNELS) {
    const m = metrics.byChannel[ch];
    const prefix = channelPrefix(ch);
    const deliveryRate = Number(
      pricing[`${prefix}DeliveryCad` as keyof AdNotificationPricingRates] ?? 0,
    );
    const interactionRate = Number(
      pricing[`${prefix}InteractionCad` as keyof AdNotificationPricingRates] ??
        0,
    );
    const conversionRate = Number(
      pricing[`${prefix}ConversionCad` as keyof AdNotificationPricingRates] ?? 0,
    );
    total +=
      m.deliveries * deliveryRate +
      m.interactions * interactionRate +
      m.conversions * conversionRate;
  }
  return Number(total.toFixed(2));
}
