import { Logger } from '@nestjs/common';

const logger = new Logger('MetaWhatsApp');

export type WhatsAppCloudConfig = {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
};

export type WhatsAppCloudSendMode = 'template' | 'text';

export function isAdNotificationWhatsAppEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.AD_NOTIFICATION_WHATSAPP_ENABLED === 'true';
}

export function readWhatsAppCloudConfig(
  env: NodeJS.ProcessEnv,
): WhatsAppCloudConfig | null {
  const accessToken =
    env.WHATSAPP_CLOUD_ACCESS_TOKEN?.trim() ||
    env.META_WHATSAPP_ACCESS_TOKEN?.trim() ||
    '';
  const phoneNumberId =
    env.WHATSAPP_CLOUD_PHONE_NUMBER_ID?.trim() ||
    env.META_WHATSAPP_PHONE_NUMBER_ID?.trim() ||
    '';
  if (!accessToken || !phoneNumberId) return null;
  const apiVersion =
    env.WHATSAPP_CLOUD_API_VERSION?.trim() ||
    env.META_WHATSAPP_API_VERSION?.trim() ||
    'v21.0';
  return { accessToken, phoneNumberId, apiVersion };
}

export function whatsAppCloudSendMode(env: NodeJS.ProcessEnv): WhatsAppCloudSendMode {
  const raw = (env.AD_NOTIFICATION_WHATSAPP_SEND_MODE ?? 'template')
    .trim()
    .toLowerCase();
  return raw === 'text' ? 'text' : 'template';
}

/** Numéro destinataire Cloud API : chiffres uniquement, sans « + » (ex. 15145551234). */
export function phoneToWhatsAppCloudRecipient(
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
  const digits = e164.replace(/\D/g, '');
  return digits.length >= 8 ? digits : null;
}

function graphMessagesUrl(config: WhatsAppCloudConfig): string {
  return `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;
}

type GraphErrorBody = {
  error?: { message?: string; code?: number; error_subcode?: number };
};

export type WhatsAppCloudProbeResult = {
  ok: boolean;
  displayPhoneNumber?: string;
  verifiedName?: string;
  error?: string;
};

/** Vérifie le token et le phone_number_id Meta sans envoyer de message. */
export async function probeWhatsAppCloudApi(
  config: WhatsAppCloudConfig,
): Promise<WhatsAppCloudProbeResult> {
  const url = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}?fields=verified_name,display_phone_number,quality_rating`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.accessToken}` },
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json().catch(() => ({}))) as GraphErrorBody & {
      verified_name?: string;
      display_phone_number?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: data.error?.message ?? `WhatsApp Graph HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      verifiedName: data.verified_name,
      displayPhoneNumber: data.display_phone_number,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function postWhatsAppCloudMessage(
  config: WhatsAppCloudConfig,
  payload: Record<string, unknown>,
): Promise<{ messageId: string | null }> {
  const res = await fetch(graphMessagesUrl(config), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as GraphErrorBody & {
    messages?: Array<{ id?: string }>;
  };
  if (!res.ok) {
    throw new Error(
      data.error?.message ??
        `WhatsApp Cloud API HTTP ${res.status}`,
    );
  }
  return { messageId: data.messages?.[0]?.id ?? null };
}

export async function sendWhatsAppCloudTextMessage(args: {
  config: WhatsAppCloudConfig;
  to: string;
  body: string;
}): Promise<{ messageId: string | null }> {
  return postWhatsAppCloudMessage(args.config, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: args.to,
    type: 'text',
    text: {
      preview_url: true,
      body: args.body.slice(0, 4096),
    },
  });
}

export type WhatsAppTemplateBodyParam = { type: 'text'; text: string };

/**
 * Message template Meta (hors fenêtre 24 h — promos ads).
 * Le modèle doit être approuvé dans Meta Business Manager.
 */
export async function sendWhatsAppCloudTemplateMessage(args: {
  config: WhatsAppCloudConfig;
  to: string;
  templateName: string;
  languageCode: string;
  bodyParameters: WhatsAppTemplateBodyParam[];
  urlButtonParameter?: string;
  urlButtonIndex?: string;
}): Promise<{ messageId: string | null }> {
  const components: Array<Record<string, unknown>> = [];
  if (args.bodyParameters.length > 0) {
    components.push({
      type: 'body',
      parameters: args.bodyParameters,
    });
  }
  if (args.urlButtonParameter?.trim()) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: args.urlButtonIndex ?? '0',
      parameters: [{ type: 'text', text: args.urlButtonParameter.trim() }],
    });
  }
  return postWhatsAppCloudMessage(args.config, {
    messaging_product: 'whatsapp',
    to: args.to,
    type: 'template',
    template: {
      name: args.templateName,
      language: { code: args.languageCode },
      ...(components.length > 0 ? { components } : {}),
    },
  });
}

/** Suffixe dynamique pour bouton URL du template (après le préfixe fixe du modèle). */
export function whatsAppTemplateUrlButtonSuffix(
  webUrl: string,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const prefix = env.AD_NOTIFICATION_WHATSAPP_TEMPLATE_URL_PREFIX?.trim();
  if (!prefix) return webUrl.slice(0, 200);
  if (webUrl.startsWith(prefix)) {
    return webUrl.slice(prefix.length).slice(0, 200) || '/';
  }
  try {
    const u = new URL(webUrl);
    return `${u.pathname}${u.search}`.slice(0, 200) || '/';
  } catch {
    return webUrl.slice(0, 200);
  }
}

export async function trySendAdWhatsApp(args: {
  env: NodeJS.ProcessEnv;
  toPhone: string;
  storeName: string;
  title: string;
  body: string;
  webUrl: string;
}): Promise<boolean> {
  if (!isAdNotificationWhatsAppEnabled(args.env)) return false;
  const config = readWhatsAppCloudConfig(args.env);
  if (!config) {
    logger.warn(
      'WhatsApp ads: WHATSAPP_CLOUD_ACCESS_TOKEN et WHATSAPP_CLOUD_PHONE_NUMBER_ID requis',
    );
    return false;
  }
  const defaultCc =
    args.env.AD_NOTIFICATION_WHATSAPP_DEFAULT_COUNTRY_CODE?.trim() || '1';
  const to = phoneToWhatsAppCloudRecipient(args.toPhone, defaultCc);
  if (!to) return false;

  const mode = whatsAppCloudSendMode(args.env);
  try {
    if (mode === 'text') {
      const textBody =
        `${args.storeName} — ${args.title}\n${args.body}\n${args.webUrl}`.slice(
          0,
          4096,
        );
      await sendWhatsAppCloudTextMessage({ config, to, body: textBody });
      return true;
    }

    const templateName =
      args.env.AD_NOTIFICATION_WHATSAPP_TEMPLATE_NAME?.trim() || '';
    if (!templateName) {
      logger.warn(
        'WhatsApp ads template: AD_NOTIFICATION_WHATSAPP_TEMPLATE_NAME manquant (mode template)',
      );
      return false;
    }
    const languageCode =
      args.env.AD_NOTIFICATION_WHATSAPP_TEMPLATE_LANGUAGE?.trim() || 'fr';
    const useUrlButton =
      args.env.AD_NOTIFICATION_WHATSAPP_TEMPLATE_URL_BUTTON === 'true';
    const bodyParameters: WhatsAppTemplateBodyParam[] = [
      { type: 'text', text: args.storeName.slice(0, 120) },
      { type: 'text', text: args.title.slice(0, 120) },
      { type: 'text', text: args.body.slice(0, 500) },
    ];
    const extraBody = args.env.AD_NOTIFICATION_WHATSAPP_TEMPLATE_BODY_URL_PARAM;
    if (extraBody === 'true') {
      bodyParameters.push({
        type: 'text',
        text: args.webUrl.slice(0, 500),
      });
    }

    await sendWhatsAppCloudTemplateMessage({
      config,
      to,
      templateName,
      languageCode,
      bodyParameters,
      urlButtonParameter: useUrlButton
        ? whatsAppTemplateUrlButtonSuffix(args.webUrl, args.env)
        : undefined,
      urlButtonIndex:
        args.env.AD_NOTIFICATION_WHATSAPP_TEMPLATE_URL_BUTTON_INDEX?.trim() ||
        '0',
    });
    return true;
  } catch (e) {
    logger.warn(
      `WhatsApp Cloud ads send failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}
