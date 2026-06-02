import { Logger } from '@nestjs/common';

const logger = new Logger('TwilioWhatsApp');

export type TwilioWhatsAppConfig = {
  accountSid: string;
  authToken: string;
  from: string;
};

export function readTwilioWhatsAppConfig(env: NodeJS.ProcessEnv): TwilioWhatsAppConfig | null {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim() ?? '';
  const authToken = env.TWILIO_AUTH_TOKEN?.trim() ?? '';
  const from =
    env.TWILIO_WHATSAPP_FROM?.trim() ||
    env.TWILIO_WHATSAPP_SENDER?.trim() ||
    '';
  if (!accountSid || !authToken || !from) return null;
  return { accountSid, authToken, from: normalizeWhatsAppAddress(from) };
}

export function isAdNotificationWhatsAppEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.AD_NOTIFICATION_WHATSAPP_ENABLED === 'true';
}

/** `+15145551234` → `whatsapp:+15145551234` */
export function normalizeWhatsAppAddress(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  if (t.startsWith('whatsapp:')) return t;
  const digits = t.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return `whatsapp:${digits}`;
  return `whatsapp:+${digits.replace(/^\+/, '')}`;
}

/**
 * Numéro client → E.164 WhatsApp (défaut CA si 10 chiffres).
 */
export function phoneToWhatsAppRecipient(
  phone: string,
  defaultCountryCode = '1',
): string | null {
  const cleaned = phone.replace(/[^\d+]/g, '').trim();
  if (!cleaned) return null;
  let e164 = cleaned;
  if (!e164.startsWith('+')) {
    if (e164.length === 10 && defaultCountryCode === '1') {
      e164 = `+1${e164}`;
    } else {
      e164 = `+${defaultCountryCode}${e164}`;
    }
  }
  if (e164.length < 8) return null;
  return normalizeWhatsAppAddress(e164);
}

export async function sendTwilioWhatsAppMessage(args: {
  config: TwilioWhatsAppConfig;
  to: string;
  body: string;
}): Promise<{ sid: string | null }> {
  const to = normalizeWhatsAppAddress(args.to);
  const url = `https://api.twilio.com/2010-04-01/Accounts/${args.config.accountSid}/Messages.json`;
  const auth = Buffer.from(
    `${args.config.accountSid}:${args.config.authToken}`,
  ).toString('base64');
  const form = new URLSearchParams({
    To: to,
    From: args.config.from,
    Body: args.body.slice(0, 1600),
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as {
    sid?: string;
    message?: string;
    code?: number;
  };
  if (!res.ok) {
    throw new Error(
      data.message ?? `Twilio WhatsApp HTTP ${res.status}`,
    );
  }
  return { sid: data.sid ?? null };
}

export async function trySendAdWhatsApp(args: {
  env: NodeJS.ProcessEnv;
  toPhone: string;
  body: string;
}): Promise<boolean> {
  if (!isAdNotificationWhatsAppEnabled(args.env)) return false;
  const config = readTwilioWhatsAppConfig(args.env);
  if (!config) {
    logger.warn('WhatsApp ads: TWILIO_ACCOUNT_SID / AUTH_TOKEN / WHATSAPP_FROM manquants');
    return false;
  }
  const defaultCc =
    args.env.AD_NOTIFICATION_WHATSAPP_DEFAULT_COUNTRY_CODE?.trim() || '1';
  const to = phoneToWhatsAppRecipient(args.toPhone, defaultCc);
  if (!to) return false;
  try {
    await sendTwilioWhatsAppMessage({ config, to, body: args.body });
    return true;
  } catch (e) {
    logger.warn(
      `WhatsApp ads send failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}
