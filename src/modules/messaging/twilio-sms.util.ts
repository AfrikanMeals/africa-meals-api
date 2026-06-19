export type TwilioSmsConfig = {
  accountSid: string;
  authToken: string;
  from: string;
};

export function readTwilioSmsConfig(env: NodeJS.ProcessEnv): TwilioSmsConfig | null {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim() ?? '';
  const authToken = env.TWILIO_AUTH_TOKEN?.trim() ?? '';
  const from =
    env.TWILIO_SMS_FROM?.trim() ||
    env.TWILIO_PHONE_NUMBER?.trim() ||
    '';
  if (!accountSid || !authToken || !from) return null;
  return { accountSid, authToken, from };
}

export async function sendTwilioSmsMessage(args: {
  config: TwilioSmsConfig;
  to: string;
  body: string;
}): Promise<{ messageId: string | null }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(args.config.accountSid)}/Messages.json`;
  const params = new URLSearchParams({
    To: args.to,
    From: args.config.from,
    Body: args.body.slice(0, 1600),
  });
  const auth = Buffer.from(
    `${args.config.accountSid}:${args.config.authToken}`,
  ).toString('base64');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    sid?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(data.message ?? `Twilio HTTP ${res.status}`);
  }
  return { messageId: data.sid ?? null };
}
