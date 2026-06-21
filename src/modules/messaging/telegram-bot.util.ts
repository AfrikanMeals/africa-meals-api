export type TelegramBotConfig = {
  botToken: string;
  apiBaseUrl: string;
};

export function readTelegramBotConfig(
  env: NodeJS.ProcessEnv,
): TelegramBotConfig | null {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim() ?? '';
  if (!botToken) return null;
  const apiBaseUrl =
    env.TELEGRAM_API_BASE_URL?.trim().replace(/\/+$/, '') ||
    'https://api.telegram.org';
  return { botToken, apiBaseUrl };
}

export function isTelegramBotConfigured(env: NodeJS.ProcessEnv): boolean {
  return readTelegramBotConfig(env) != null;
}

export async function probeTelegramBotApi(args: {
  config: TelegramBotConfig;
}): Promise<{ ok: boolean; error?: string }> {
  const url = `${args.config.apiBaseUrl}/bot${args.config.botToken}/getMe`;
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
    };
    if (!res.ok || data.ok === false) {
      return {
        ok: false,
        error: data.description ?? `Telegram HTTP ${res.status}`,
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Envoie un message via l’API Bot Telegram (sendMessage). */
export async function sendTelegramBotMessage(args: {
  config: TelegramBotConfig;
  chatId: string;
  text: string;
}): Promise<{ messageId: number | null }> {
  const url = `${args.config.apiBaseUrl}/bot${args.config.botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: args.chatId.trim(),
      text: args.text.slice(0, 4096),
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: { message_id?: number };
    description?: string;
  };
  if (!res.ok || data.ok === false) {
    throw new Error(data.description ?? `Telegram HTTP ${res.status}`);
  }
  return { messageId: data.result?.message_id ?? null };
}
