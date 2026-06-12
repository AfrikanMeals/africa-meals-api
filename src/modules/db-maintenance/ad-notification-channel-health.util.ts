import type { AdNotificationChannelAvailability } from '@modules/ads/ad-notification-channel-availability.util';
import {
  isAdNotificationSmsEnabled,
  isAdNotificationWhatsAppEnabled,
  readBirdSmsConfig,
  readBirdWhatsAppConfig,
} from '@modules/ads/bird-channels.util';

export type AdNotificationChannelKey =
  | 'email'
  | 'push'
  | 'inApp'
  | 'sms'
  | 'whatsapp';

export type AdNotificationChannelHealthRow = {
  channel: AdNotificationChannelKey;
  label: string;
  adminEnabled: boolean;
  runtimeReady: boolean;
  details: string;
};

export type AdNotificationChannelHealthEvaluation = {
  rows: AdNotificationChannelHealthRow[];
  pricingDocFound: boolean;
  redisConfigured: boolean;
  dispatchCronDisabled: boolean;
  mqBrokerEnabled: boolean;
  /** Canaux activés côté admin mais non prêts côté runtime. */
  misconfiguredChannels: AdNotificationChannelKey[];
};

const CHANNEL_META: Array<{ key: AdNotificationChannelKey; label: string }> = [
  { key: 'email', label: 'E-mail' },
  { key: 'push', label: 'Push (FCM)' },
  { key: 'inApp', label: 'In-App' },
  { key: 'sms', label: 'SMS' },
  { key: 'whatsapp', label: 'WhatsApp' },
];

function smtpConfigured(env: NodeJS.ProcessEnv): boolean {
  const host = env.SMTP_HOST?.trim() ?? env.MAILER_HOST?.trim() ?? '';
  const user = env.SMTP_USER?.trim() ?? env.MAILER_USER?.trim() ?? '';
  const pass = env.SMTP_PASS?.trim() ?? env.MAILER_PASS?.trim() ?? '';
  return Boolean(host && user && pass);
}

function redisConfigured(env: NodeJS.ProcessEnv): boolean {
  const url =
    env.REDIS_URL?.trim() ||
    env.BULLMQ_REDIS_URL?.trim() ||
    env.REDIS_CONNECTION_URL?.trim() ||
    '';
  return Boolean(url);
}

export function evaluateAdNotificationChannelHealth(input: {
  availability: AdNotificationChannelAvailability;
  env: NodeJS.ProcessEnv;
  firebaseMessagingOk: boolean;
  wsReachable: boolean;
  pricingDocFound: boolean;
  mqBrokerEnabled: boolean;
}): AdNotificationChannelHealthEvaluation {
  const env = input.env;
  const dispatchCronDisabled =
    env.DISABLE_AD_NOTIFICATION_DISPATCH_CRON === 'true';
  const redisOk = redisConfigured(env);
  const birdSms = readBirdSmsConfig(env);
  const smsRuntime =
    isAdNotificationSmsEnabled(env) && birdSms != null;
  const waRuntime =
    isAdNotificationWhatsAppEnabled(env) &&
    readBirdWhatsAppConfig(env) != null;
  const emailRuntime = smtpConfigured(env);
  const pushRuntime = input.firebaseMessagingOk;
  const inAppRuntime = input.wsReachable;

  const runtimeByChannel: Record<AdNotificationChannelKey, boolean> = {
    email: emailRuntime,
    push: pushRuntime,
    inApp: inAppRuntime,
    sms: smsRuntime,
    whatsapp: waRuntime,
  };

  const detailsByChannel: Record<AdNotificationChannelKey, string> = {
    email: emailRuntime
      ? 'SMTP configuré'
      : 'SMTP manquant (SMTP_HOST/USER/PASS ou MAILER_*)',
    push: pushRuntime
      ? 'Firebase Messaging initialisé'
      : 'Firebase Messaging indisponible',
    inApp: inAppRuntime
      ? 'Service WS joignable'
      : 'WS interne injoignable (AFRICA_MEALS_WS_INTERNAL_URL)',
    sms: smsRuntime
      ? 'Canal SMS configuré + AD_NOTIFICATION_SMS_ENABLED=true'
      : !isAdNotificationSmsEnabled(env)
        ? 'AD_NOTIFICATION_SMS_ENABLED≠true'
        : 'Canal SMS incomplet (credentials requis)',
    whatsapp: waRuntime
      ? 'Canal WhatsApp configuré'
      : !isAdNotificationWhatsAppEnabled(env)
        ? 'AD_NOTIFICATION_WHATSAPP_ENABLED≠true'
        : 'Canal WhatsApp incomplet (credentials requis)',
  };

  const misconfiguredChannels: AdNotificationChannelKey[] = [];
  const rows: AdNotificationChannelHealthRow[] = CHANNEL_META.map(
    ({ key, label }) => {
      const adminEnabled = input.availability[key];
      const runtimeReady = runtimeByChannel[key];
      if (adminEnabled && !runtimeReady) {
        misconfiguredChannels.push(key);
      }
      return {
        channel: key,
        label,
        adminEnabled,
        runtimeReady,
        details: adminEnabled
          ? detailsByChannel[key]
          : 'Désactivé dans Paramètres notifications',
      };
    },
  );

  return {
    rows,
    pricingDocFound: input.pricingDocFound,
    redisConfigured: redisOk,
    dispatchCronDisabled,
    mqBrokerEnabled: input.mqBrokerEnabled,
    misconfiguredChannels,
  };
}

export function channelHealthSummary(
  evaluation: AdNotificationChannelHealthEvaluation,
): { status: 'healthy' | 'degraded' | 'down'; details: string } {
  const parts: string[] = [];

  if (!evaluation.pricingDocFound) {
    parts.push('Barème notifications (ad_notification_pricing_settings) introuvable');
  }
  if (!evaluation.redisConfigured) {
    parts.push('Redis/BullMQ URL manquant (file ads-notify)');
  }
  if (evaluation.dispatchCronDisabled) {
    parts.push('Cron dispatch notifications désactivé');
  }
  if (!evaluation.mqBrokerEnabled) {
    parts.push('MQ Broker désactivé (runtime infra)');
  }

  for (const row of evaluation.rows) {
    const flag = !row.adminEnabled
      ? 'off'
      : row.runtimeReady
        ? 'ok'
        : 'ko';
    parts.push(`${row.label}: admin=${row.adminEnabled ? 'on' : 'off'} runtime=${flag}`);
  }

  let status: 'healthy' | 'degraded' | 'down' = 'healthy';
  if (
    !evaluation.pricingDocFound ||
    (!evaluation.redisConfigured && evaluation.mqBrokerEnabled)
  ) {
    status = 'down';
  } else if (
    evaluation.misconfiguredChannels.length > 0 ||
    evaluation.dispatchCronDisabled ||
    !evaluation.mqBrokerEnabled
  ) {
    status = 'degraded';
  }

  return { status, details: parts.join(' | ') };
}
