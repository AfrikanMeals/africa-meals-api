import type { ConfigService } from '@nestjs/config';

export type AuthOtpEmailVariant = 'signup' | 'activation' | 'reset' | '2fa' | '2fa-login';

export type AuthOtpDeepLinkFlow = 'verify' | 'reset';

const PUBLIC_URL_KEYS = [
  'EMAIL_WEBSITE_URL',
  'PUBLIC_WEB_URL',
  'FRONTEND_URL',
  'CLIENT_APP_URL',
  'DASHBOARD_BASE_URL',
  'WEBSITE_URL',
] as const;

function pickPublicBaseUrl(
  get: (key: string) => string | undefined,
): string | null {
  for (const key of PUBLIC_URL_KEYS) {
    const v = get(key)?.trim();
    if (v) return v.replace(/\/+$/, '');
  }
  return null;
}

export function resolveOtpAutofillDomain(
  config: ConfigService | { get: (key: string) => string | undefined },
): string {
  const get = (key: string) => config.get(key);
  const explicit = get('EMAIL_OTP_DOMAIN')?.trim();
  if (explicit) return explicit.replace(/^@/, '').toLowerCase();

  const base = pickPublicBaseUrl(get);
  if (base) {
    try {
      return new URL(base).hostname.toLowerCase();
    } catch {
      /* ignore */
    }
  }
  return 'wise-eat.com';
}

export function resolveOtpWebBaseUrl(
  config: ConfigService | { get: (key: string) => string | undefined },
): string {
  return pickPublicBaseUrl((key) => config.get(key)) ?? 'https://wise-eat.com';
}

export function resolveMobileDeepLinkScheme(
  config: ConfigService | { get: (key: string) => string | undefined },
): string {
  return (
    config.get('MOBILE_DEEP_LINK_SCHEME')?.trim().replace(/:\/\//, '') ||
    'wise-eat'
  );
}

export function mapOtpVariantToDeepLinkFlow(
  variant: AuthOtpEmailVariant,
): AuthOtpDeepLinkFlow {
  return variant === 'reset' ? 'reset' : 'verify';
}

/** Ligne reconnue par iOS Mail pour l’autofill OTP domain-bound. */
export function buildAppleOtpAutofillLine(
  domain: string,
  code: string,
): string {
  const host = domain.replace(/^@/, '').toLowerCase();
  return `@${host} #${code.trim().toUpperCase()}`;
}

export function buildAuthOtpWebDeepLink(args: {
  webBaseUrl: string;
  flow: AuthOtpDeepLinkFlow;
  email: string;
  code: string;
}): string {
  const base = args.webBaseUrl.replace(/\/+$/, '');
  const q = new URLSearchParams({
    flow: args.flow,
    email: args.email.trim().toLowerCase(),
    code: args.code.trim().toUpperCase(),
  });
  return `${base}/auth/otp?${q.toString()}`;
}

export function buildAuthOtpAppDeepLink(args: {
  appScheme: string;
  flow: AuthOtpDeepLinkFlow;
  email: string;
  code: string;
}): string {
  const scheme = args.appScheme.replace(/:\/\//, '');
  const q = new URLSearchParams({
    flow: args.flow,
    email: args.email.trim().toLowerCase(),
    code: args.code.trim().toUpperCase(),
  });
  return `${scheme}://auth/otp?${q.toString()}`;
}

/** Snippet HTML discret pour l’autofill iOS (en complément du texte brut). */
export function emailOtpAutofillSnippet(domain: string, code: string): string {
  const line = buildAppleOtpAutofillLine(domain, code);
  return `<p style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:#ffffff;">${line}</p>`;
}

export function buildAuthOtpPlainText(args: {
  appName: string;
  code: string;
  variant: AuthOtpEmailVariant;
  domain: string;
  webDeepLink: string;
}): string {
  const normalized = args.code.trim().toUpperCase();
  const validity =
    args.variant === 'reset' || args.variant === '2fa' || args.variant === '2fa-login'
      ? '15 minutes'
      : '30 minutes';
  const autofillLine = buildAppleOtpAutofillLine(args.domain, normalized);
  const intro =
    args.variant === 'reset'
      ? 'Code de réinitialisation'
      : args.variant === 'signup'
        ? 'Code d’inscription'
        : args.variant === '2fa'
          ? 'Code d’activation 2FA'
          : args.variant === '2fa-login'
            ? 'Code de connexion 2FA'
            : 'Code d’activation';

  return [
    `${args.appName} — ${intro} : ${normalized} (valable ${validity}).`,
    autofillLine,
    `Ouvrir dans l’app : ${args.webDeepLink}`,
  ].join('\n');
}
