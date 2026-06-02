import { Logger } from '@nestjs/common';

const logger = new Logger('TwilioSms');

export type TwilioSmsConfig = {
  accountSid: string;
  authToken: string;
  /** Numéro expéditeur E.164 si pas de Messaging Service. */
  from?: string;
  /** Messaging Service SID (recommandé en prod) — prioritaire sur `from`. */
  messagingServiceSid?: string;
};

export function readTwilioSmsConfig(env: NodeJS.ProcessEnv): TwilioSmsConfig | null {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim() ?? '';
  const authToken = env.TWILIO_AUTH_TOKEN?.trim() ?? '';
  if (!accountSid || !authToken) return null;

  const messagingServiceSid =
    env.TWILIO_SERVICE_ID?.trim() ||
    env.TWILIO_MESSAGING_SERVICE_SID?.trim() ||
    '';
  const from =
    env.TWILIO_PHONE_NUMBER?.trim() ||
    env.TWILIO_SMS_FROM?.trim() ||
    '';

  if (!messagingServiceSid && !from) return null;
  return {
    accountSid,
    authToken,
    from: from || undefined,
    messagingServiceSid: messagingServiceSid || undefined,
  };
}

export function isAdNotificationSmsEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.AD_NOTIFICATION_SMS_ENABLED === 'true';
}

/** Numéro client → E.164 SMS (défaut CA si 10 chiffres). */
export function phoneToSmsE164(
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
  return e164.length >= 8 ? e164 : null;
}

export async function sendTwilioSmsMessage(args: {
  config: TwilioSmsConfig;
  to: string;
  body: string;
}): Promise<{ sid: string | null }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${args.config.accountSid}/Messages.json`;
  const auth = Buffer.from(
    `${args.config.accountSid}:${args.config.authToken}`,
  ).toString('base64');

  const form = new URLSearchParams({
    To: args.to,
    Body: args.body.slice(0, 1600),
  });
  if (args.config.messagingServiceSid) {
    form.set('MessagingServiceSid', args.config.messagingServiceSid);
  } else if (args.config.from) {
    form.set('From', args.config.from);
  } else {
    throw new Error('Twilio SMS: TWILIO_SERVICE_ID ou TWILIO_PHONE_NUMBER requis');
  }

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
    throw new Error(data.message ?? `Twilio SMS HTTP ${res.status}`);
  }
  return { sid: data.sid ?? null };
}

export async function trySendAdSms(args: {
  env: NodeJS.ProcessEnv;
  toPhone: string;
  body: string;
}): Promise<boolean> {
  if (!isAdNotificationSmsEnabled(args.env)) return false;
  const config = readTwilioSmsConfig(args.env);
  if (!config) {
    logger.warn(
      'SMS ads: TWILIO_ACCOUNT_SID / AUTH_TOKEN et (TWILIO_SERVICE_ID ou TWILIO_PHONE_NUMBER) requis',
    );
    return false;
  }
  const defaultCc =
    args.env.AD_NOTIFICATION_SMS_DEFAULT_COUNTRY_CODE?.trim() ||
    args.env.AD_NOTIFICATION_WHATSAPP_DEFAULT_COUNTRY_CODE?.trim() ||
    '1';
  const to = phoneToSmsE164(args.toPhone, defaultCc);
  if (!to) return false;
  try {
    await sendTwilioSmsMessage({ config, to, body: args.body });
    return true;
  } catch (e) {
    logger.warn(
      `SMS ads send failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}
