import { createHmac, timingSafeEqual } from 'crypto';

const DEFAULT_TTL_SEC = 60 * 60 * 24 * 90;

export function resolveFoodNewsletterSigningSecret(config: {
  get: (key: string) => string | undefined;
}): string {
  return (
    config.get('FOOD_NEWSLETTER_TRACK_SECRET')?.trim() ||
    config.get('JWT_SECRET')?.trim() ||
    ''
  );
}

export function issueFoodNewsletterToken(
  subject: string,
  secret: string,
  ttlSec = DEFAULT_TTL_SEC,
): string {
  const id = subject.trim();
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${id}.${exp}`;
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${exp}.${sig}`;
}

export function verifyFoodNewsletterToken(
  subject: string,
  token: string | undefined,
  secret: string,
): boolean {
  const id = subject.trim();
  const raw = token?.trim() ?? '';
  const key = secret.trim();
  if (!id || !raw || !key) return false;
  const dot = raw.indexOf('.');
  if (dot <= 0) return false;
  const exp = Number(raw.slice(0, dot));
  const sig = raw.slice(dot + 1);
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000) || !sig) {
    return false;
  }
  const payload = `${id}.${exp}`;
  const expected = createHmac('sha256', key).update(payload).digest('base64url');
  const left = Buffer.from(expected);
  const right = Buffer.from(sig);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
