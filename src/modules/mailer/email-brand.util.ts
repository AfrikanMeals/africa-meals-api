import type { ConfigService } from '@nestjs/config';

/** Palette alignée sur le site vitrine (brun / or / crème). */
export type EmailBrandColors = {
  primary: string;
  accent: string;
  accentLight: string;
  background: string;
  card: string;
  text: string;
  textMuted: string;
  textOnDark: string;
};

export const EMAIL_BRAND_DEFAULTS: EmailBrandColors = {
  primary: '#392800',
  accent: '#aa6900',
  accentLight: '#d4a017',
  background: '#f5f0e8',
  card: '#ffffff',
  text: '#374151',
  textMuted: '#6b7280',
  textOnDark: '#fdf8f0',
};

export type EmailBrand = {
  appName: string;
  supportEmail: string;
  websiteUrl: string | null;
  logoUrl: string | null;
  colors: EmailBrandColors;
};

/** Retire guillemets entourants (.env `EMAIL_BRAND_PRIMARY="#392800"`). */
export function normalizeEmailBrandColor(
  raw: string | undefined,
  fallback: string,
): string {
  const v = raw?.trim().replace(/^["']+|["']+$/g, '') ?? '';
  return v || fallback;
}

export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function pickPublicBaseUrl(
  get: (key: string) => string | undefined,
): string | null {
  const keys = [
    'EMAIL_WEBSITE_URL',
    'PUBLIC_WEB_URL',
    'FRONTEND_URL',
    'CLIENT_APP_URL',
    'DASHBOARD_BASE_URL',
    'WEBSITE_URL',
  ];
  for (const key of keys) {
    const v = get(key)?.trim();
    if (v) return v.replace(/\/+$/, '');
  }
  return null;
}

export function resolveEmailBrand(
  config: ConfigService | { get: (key: string) => string | undefined },
): EmailBrand {
  const get = (key: string) => config.get(key);

  const appName = get('APP_NAME')?.trim() || 'Wise Eat';
  const supportEmail =
    get('SUPPORT_EMAIL')?.trim() ||
    get('SMTP_FROM')?.trim() ||
    'support@afrikameals.com';

  const websiteUrl = pickPublicBaseUrl(get);

  const explicitLogo = get('EMAIL_LOGO_URL')?.trim();
  const logoUrl =
    explicitLogo ||
    (websiteUrl ? `${websiteUrl}/logo.png` : null) ||
    null;

  const primary = normalizeEmailBrandColor(
    get('EMAIL_BRAND_PRIMARY'),
    EMAIL_BRAND_DEFAULTS.primary,
  );
  const accent = normalizeEmailBrandColor(
    get('EMAIL_BRAND_ACCENT'),
    EMAIL_BRAND_DEFAULTS.accent,
  );

  return {
    appName,
    supportEmail,
    websiteUrl,
    logoUrl,
    colors: {
      ...EMAIL_BRAND_DEFAULTS,
      primary,
      accent,
    },
  };
}
