import { Logger } from '@nestjs/common';

const logger = new Logger('NotificationChannels');

export type BirdConfig = {
  accessKey: string;
  workspaceId: string;
  apiBaseUrl: string;
  smsChannelId?: string;
  whatsappChannelId?: string;
};

export type BirdChannelProbeResult = {
  ok: boolean;
  channelName?: string;
  platform?: string;
  error?: string;
};

export type BirdWhatsAppSendMode = 'template' | 'text';

export type BirdTemplateParameter = {
  type: 'string';
  key: string;
  value: string;
};

function birdApiBaseUrl(env: NodeJS.ProcessEnv): string {
  return (
    env.BIRD_API_BASE_URL?.trim().replace(/\/+$/, '') ||
    'https://api.bird.com'
  );
}

export function readBirdConfig(env: NodeJS.ProcessEnv): BirdConfig | null {
  const accessKey = env.BIRD_ACCESS_KEY?.trim() ?? '';
  const workspaceId = env.BIRD_WORKSPACE_ID?.trim() ?? '';
  if (!accessKey || !workspaceId) return null;

  const smsChannelId =
    env.BIRD_SMS_CHANNEL_ID?.trim() ||
    env.BIRD_SMS_CHANNEL?.trim() ||
    '';
  const whatsappChannelId =
    env.BIRD_WHATSAPP_CHANNEL_ID?.trim() ||
    env.BIRD_WHATSAPP_CHANNEL?.trim() ||
    '';

  return {
    accessKey,
    workspaceId,
    apiBaseUrl: birdApiBaseUrl(env),
    smsChannelId: smsChannelId || undefined,
    whatsappChannelId: whatsappChannelId || undefined,
  };
}

export function readBirdSmsConfig(env: NodeJS.ProcessEnv): BirdConfig | null {
  const config = readBirdConfig(env);
  if (!config?.smsChannelId) return null;
  return config;
}

export function readBirdWhatsAppConfig(
  env: NodeJS.ProcessEnv,
): BirdConfig | null {
  const config = readBirdConfig(env);
  if (!config?.whatsappChannelId) return null;
  return config;
}

export function isAdNotificationSmsEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.AD_NOTIFICATION_SMS_ENABLED === 'true';
}

export function isAdNotificationWhatsAppEnabled(
  env: NodeJS.ProcessEnv,
): boolean {
  return env.AD_NOTIFICATION_WHATSAPP_ENABLED === 'true';
}

/** Numéro client → E.164 Bird (ex. +15145551234). */
export function phoneToBirdE164(
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

/** Alias conservé pour les appels existants (SMS). */
export const phoneToSmsE164 = phoneToBirdE164;

function birdAuthHeaders(accessKey: string): Record<string, string> {
  return {
    Authorization: `AccessKey ${accessKey}`,
    'Content-Type': 'application/json',
  };
}

function birdMessagesUrl(
  config: BirdConfig,
  channelId: string,
): string {
  return `${config.apiBaseUrl}/workspaces/${config.workspaceId}/channels/${channelId}/messages`;
}

function birdChannelUrl(config: BirdConfig, channelId: string): string {
  return `${config.apiBaseUrl}/workspaces/${config.workspaceId}/channels/${channelId}`;
}

type BirdErrorBody = {
  message?: string;
  code?: string;
};

async function parseBirdResponse(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}));
}

/** Vérifie l’access key et le canal Bird sans envoyer de message. */
export async function probeBirdChannelApi(args: {
  config: BirdConfig;
  channelId: string;
}): Promise<BirdChannelProbeResult> {
  const url = birdChannelUrl(args.config, args.channelId);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: birdAuthHeaders(args.config.accessKey),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await parseBirdResponse(res)) as BirdErrorBody & {
      name?: string;
      platform?: { name?: string };
      status?: string;
    };
    if (!res.ok) {
      return {
        ok: false,
        error: data.message ?? `Bird HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      channelName: data.name,
      platform: data.platform?.name ?? data.status,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

async function postBirdChannelMessage(args: {
  config: BirdConfig;
  channelId: string;
  payload: Record<string, unknown>;
}): Promise<{ messageId: string | null }> {
  const res = await fetch(birdMessagesUrl(args.config, args.channelId), {
    method: 'POST',
    headers: birdAuthHeaders(args.config.accessKey),
    body: JSON.stringify(args.payload),
  });
  const data = (await parseBirdResponse(res)) as BirdErrorBody & {
    id?: string;
  };
  if (!res.ok) {
    throw new Error(data.message ?? `Bird HTTP ${res.status}`);
  }
  return { messageId: data.id ?? null };
}

function birdReceiver(toE164: string): Record<string, unknown> {
  return {
    contacts: [
      {
        identifierKey: 'phonenumber',
        identifierValue: toE164,
      },
    ],
  };
}

export async function sendBirdSmsMessage(args: {
  config: BirdConfig;
  to: string;
  body: string;
}): Promise<{ messageId: string | null }> {
  const channelId = args.config.smsChannelId;
  if (!channelId) {
    throw new Error('SMS: BIRD_SMS_CHANNEL_ID requis');
  }
  return postBirdChannelMessage({
    config: args.config,
    channelId,
    payload: {
      receiver: birdReceiver(args.to),
      body: {
        type: 'text',
        text: { text: args.body.slice(0, 1600) },
      },
    },
  });
}

export async function sendBirdWhatsAppTextMessage(args: {
  config: BirdConfig;
  to: string;
  body: string;
}): Promise<{ messageId: string | null }> {
  const channelId = args.config.whatsappChannelId;
  if (!channelId) {
    throw new Error('WhatsApp: BIRD_WHATSAPP_CHANNEL_ID requis');
  }
  return postBirdChannelMessage({
    config: args.config,
    channelId,
    payload: {
      receiver: birdReceiver(args.to),
      body: {
        type: 'text',
        text: { text: args.body.slice(0, 4096) },
      },
    },
  });
}

export async function sendBirdWhatsAppTemplateMessage(args: {
  config: BirdConfig;
  to: string;
  projectId: string;
  version: string;
  locale: string;
  parameters: BirdTemplateParameter[];
}): Promise<{ messageId: string | null }> {
  const channelId = args.config.whatsappChannelId;
  if (!channelId) {
    throw new Error('WhatsApp: BIRD_WHATSAPP_CHANNEL_ID requis');
  }
  return postBirdChannelMessage({
    config: args.config,
    channelId,
    payload: {
      receiver: birdReceiver(args.to),
      template: {
        projectId: args.projectId,
        version: args.version,
        locale: args.locale,
        ...(args.parameters.length > 0 ? { parameters: args.parameters } : {}),
      },
    },
  });
}

export function birdWhatsAppSendMode(
  env: NodeJS.ProcessEnv,
): BirdWhatsAppSendMode {
  const raw = (env.AD_NOTIFICATION_WHATSAPP_SEND_MODE ?? 'template')
    .trim()
    .toLowerCase();
  return raw === 'text' ? 'text' : 'template';
}

function birdTemplateParamKeys(env: NodeJS.ProcessEnv): string[] {
  const raw =
    env.AD_NOTIFICATION_WHATSAPP_TEMPLATE_PARAM_KEYS?.trim() ||
    'store_name,title,message';
  return raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

/** Suffixe dynamique pour paramètre URL du template (après le préfixe fixe). */
export function birdTemplateUrlButtonSuffix(
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

export async function trySendAdSms(args: {
  env: NodeJS.ProcessEnv;
  toPhone: string;
  body: string;
}): Promise<boolean> {
  if (!isAdNotificationSmsEnabled(args.env)) return false;
  const config = readBirdSmsConfig(args.env);
  if (!config) {
    logger.warn(
      'SMS ads: credentials canal SMS requis (ACCESS_KEY, WORKSPACE_ID, SMS_CHANNEL_ID)',
    );
    return false;
  }
  const defaultCc =
    args.env.AD_NOTIFICATION_SMS_DEFAULT_COUNTRY_CODE?.trim() ||
    args.env.AD_NOTIFICATION_WHATSAPP_DEFAULT_COUNTRY_CODE?.trim() ||
    '1';
  const to = phoneToBirdE164(args.toPhone, defaultCc);
  if (!to) return false;
  try {
    await sendBirdSmsMessage({ config, to, body: args.body });
    return true;
  } catch (e) {
    logger.warn(
      `SMS ads send failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
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
  const config = readBirdWhatsAppConfig(args.env);
  if (!config) {
    logger.warn(
      'WhatsApp ads: credentials canal WhatsApp requis (ACCESS_KEY, WORKSPACE_ID, WHATSAPP_CHANNEL_ID)',
    );
    return false;
  }
  const defaultCc =
    args.env.AD_NOTIFICATION_WHATSAPP_DEFAULT_COUNTRY_CODE?.trim() || '1';
  const to = phoneToBirdE164(args.toPhone, defaultCc);
  if (!to) return false;

  const mode = birdWhatsAppSendMode(args.env);
  try {
    if (mode === 'text') {
      const textBody =
        `${args.storeName} — ${args.title}\n${args.body}\n${args.webUrl}`.slice(
          0,
          4096,
        );
      await sendBirdWhatsAppTextMessage({ config, to, body: textBody });
      return true;
    }

    const projectId =
      args.env.AD_NOTIFICATION_WHATSAPP_TEMPLATE_PROJECT_ID?.trim() ||
      args.env.AD_NOTIFICATION_WHATSAPP_TEMPLATE_NAME?.trim() ||
      '';
    if (!projectId) {
      logger.warn(
        'WhatsApp ads template: AD_NOTIFICATION_WHATSAPP_TEMPLATE_PROJECT_ID manquant (mode template)',
      );
      return false;
    }
    const version =
      args.env.AD_NOTIFICATION_WHATSAPP_TEMPLATE_VERSION?.trim() || 'latest';
    const locale =
      args.env.AD_NOTIFICATION_WHATSAPP_TEMPLATE_LANGUAGE?.trim() ||
      args.env.AD_NOTIFICATION_WHATSAPP_TEMPLATE_LOCALE?.trim() ||
      'fr';

    const keys = birdTemplateParamKeys(args.env);
    const values = [
      args.storeName.slice(0, 120),
      args.title.slice(0, 120),
      args.body.slice(0, 500),
    ];
    const parameters: BirdTemplateParameter[] = keys
      .slice(0, values.length)
      .map((key, i) => ({
        type: 'string',
        key,
        value: values[i] ?? '',
      }));

    if (args.env.AD_NOTIFICATION_WHATSAPP_TEMPLATE_BODY_URL_PARAM === 'true') {
      const urlKey =
        args.env.AD_NOTIFICATION_WHATSAPP_TEMPLATE_URL_PARAM_KEY?.trim() ||
        'url';
      parameters.push({
        type: 'string',
        key: urlKey,
        value: args.webUrl.slice(0, 500),
      });
    } else if (
      args.env.AD_NOTIFICATION_WHATSAPP_TEMPLATE_URL_BUTTON === 'true'
    ) {
      const urlKey =
        args.env.AD_NOTIFICATION_WHATSAPP_TEMPLATE_URL_PARAM_KEY?.trim() ||
        'url_suffix';
      const suffix = birdTemplateUrlButtonSuffix(args.webUrl, args.env);
      if (suffix) {
        parameters.push({ type: 'string', key: urlKey, value: suffix });
      }
    }

    await sendBirdWhatsAppTemplateMessage({
      config,
      to,
      projectId,
      version,
      locale,
      parameters,
    });
    return true;
  } catch (e) {
    logger.warn(
      `WhatsApp ads send failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}
