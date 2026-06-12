import {
  escapeEmailHtml,
  type EmailBrand,
  EMAIL_BRAND_DEFAULTS,
} from './email-brand.util';

export type WrapEmailOptions = {
  /** Texte invisible en prévisualisation boîte de réception. */
  preheader?: string;
  /** Titre document HTML. */
  title?: string;
  /**
   * Données structurées Schema.org (JSON-LD) injectées dans le `<head>`.
   * Gmail/Google les lisent pour afficher une carte (ex. reçu d'achat « Order »).
   */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
};

/**
 * Sérialise un ou plusieurs blocs JSON-LD pour une insertion sûre dans des balises `<script>`.
 */
function renderJsonLdBlocks(
  data: Record<string, unknown> | Record<string, unknown>[],
): string {
  const list = Array.isArray(data) ? data : [data];
  return list.map((entry) => renderJsonLdScript(entry)).join('\n  ');
}

function renderJsonLdScript(data: Record<string, unknown>): string {
  const json = JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<script type="application/ld+json">${json}</script>`;
}

export const EMAIL_LAYOUT_ID = 'am-email-layout';
const LAYOUT_MARKER = `id="${EMAIL_LAYOUT_ID}"`;
const SKIP_MARKER = '<!-- email-layout:skip -->';

/** Stack Plus Jakarta Sans (web font dans <head>) + fallbacks clients mail. */
export const EMAIL_FONT_FAMILY =
  "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const EMAIL_GOOGLE_FONTS_LINK =
  'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap';

const EMAIL_LOGO_WIDTH_PX = 88;

export function shouldWrapEmailHtml(html: string): boolean {
  const trimmed = html.trim();
  if (!trimmed) return false;
  if (trimmed.includes(SKIP_MARKER)) return false;
  if (trimmed.includes(LAYOUT_MARKER)) return false;
  if (/^\s*<!DOCTYPE/i.test(trimmed)) return false;
  return true;
}

export function emailHeading(text: string, level: 1 | 2 | 3 = 2): string {
  const safe = escapeEmailHtml(text);
  const sizes: Record<1 | 2 | 3, string> = {
    1: '22px',
    2: '20px',
    3: '17px',
  };
  const margins: Record<1 | 2 | 3, string> = {
    1: '0 0 20px',
    2: '0 0 16px',
    3: '0 0 12px',
  };
  return `<h${level} style="margin:${margins[level]};font-size:${sizes[level]};font-weight:700;font-family:${EMAIL_FONT_FAMILY};color:${EMAIL_BRAND_DEFAULTS.primary};line-height:1.3;">${safe}</h${level}>`;
}

export function emailParagraph(htmlOrText: string): string {
  return `<p style="margin:0 0 14px;font-size:16px;line-height:1.65;font-family:${EMAIL_FONT_FAMILY};color:${EMAIL_BRAND_DEFAULTS.text};">${htmlOrText}</p>`;
}

export function emailMutedParagraph(htmlOrText: string): string {
  return `<p style="margin:0 0 14px;font-size:14px;line-height:1.55;font-family:${EMAIL_FONT_FAMILY};color:${EMAIL_BRAND_DEFAULTS.textMuted};">${htmlOrText}</p>`;
}

export function emailDivider(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr><td style="border-top:1px solid #e8e0d4;font-size:0;line-height:0;">&nbsp;</td></tr></table>`;
}

export function emailPrimaryButton(label: string, href: string): string {
  const safeLabel = escapeEmailHtml(label);
  const safeHref = href.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0;">
  <tr>
    <td align="center" style="border-radius:10px;background:linear-gradient(135deg,${EMAIL_BRAND_DEFAULTS.primary},${EMAIL_BRAND_DEFAULTS.accent});">
      <a href="${safeHref}" target="_blank" rel="noopener noreferrer"
        style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">
        ${safeLabel}
      </a>
    </td>
  </tr>
</table>`.trim();
}

/** Bloc code OTP / vérification. */
export function emailCodeBox(code: string): string {
  const safe = escapeEmailHtml(code.trim());
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 20px;">
  <tr>
    <td align="center" style="padding:20px 24px;background:#fdf8f0;border:2px dashed ${EMAIL_BRAND_DEFAULTS.accent};border-radius:12px;">
      <span style="font-size:32px;font-weight:800;letter-spacing:0.2em;color:${EMAIL_BRAND_DEFAULTS.primary};font-family:ui-monospace,Menlo,Consolas,monospace;">${safe}</span>
    </td>
  </tr>
</table>`.trim();
}

export function emailInfoPanel(innerHtml: string): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
  <tr>
    <td style="padding:16px 18px;background:#fdf8f0;border-left:4px solid ${EMAIL_BRAND_DEFAULTS.accent};border-radius:0 10px 10px 0;font-size:15px;line-height:1.55;color:${EMAIL_BRAND_DEFAULTS.text};">
      ${innerHtml}
    </td>
  </tr>
</table>`.trim();
}

export function emailKeyValueRows(
  rows: Array<{ label: string; value: string }>,
): string {
  const cells = rows
    .map(
      (r) => `
    <tr>
      <td style="padding:6px 0;font-size:14px;color:${EMAIL_BRAND_DEFAULTS.textMuted};vertical-align:top;width:120px;">${escapeEmailHtml(r.label)}</td>
      <td style="padding:6px 0;font-size:14px;color:${EMAIL_BRAND_DEFAULTS.text};font-weight:600;">${r.value}</td>
    </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0;">${cells}</table>`;
}

function buildEmailHeader(brand: EmailBrand): string {
  const { colors, appName, logoUrl } = brand;
  const safeName = escapeEmailHtml(appName);
  const logoBlock = logoUrl
    ? `
<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 14px;">
  <tr>
    <td align="center" style="padding:6px;background:#ffffff;border-radius:14px;">
      <img src="${logoUrl.replace(/"/g, '&quot;')}" alt="${safeName}" width="${EMAIL_LOGO_WIDTH_PX}" height="auto"
        style="display:block;margin:0 auto;width:${EMAIL_LOGO_WIDTH_PX}px;max-width:${EMAIL_LOGO_WIDTH_PX}px;height:auto;border:0;border-radius:10px;" />
    </td>
  </tr>
</table>`.trim()
    : `<div style="display:inline-block;width:48px;height:48px;line-height:48px;border-radius:12px;background:rgba(255,255,255,0.15);font-size:24px;font-weight:800;font-family:${EMAIL_FONT_FAMILY};color:${colors.textOnDark};margin-bottom:14px;">${safeName.charAt(0).toUpperCase()}</div>`;

  return `
<tr>
  <td align="center" style="padding:28px 24px 24px;background:linear-gradient(135deg,${colors.primary} 0%,${colors.accent} 100%);font-family:${EMAIL_FONT_FAMILY};">
    ${logoBlock}
    <p style="margin:0;font-size:20px;font-weight:700;font-family:${EMAIL_FONT_FAMILY};color:${colors.textOnDark};letter-spacing:-0.02em;">${safeName}</p>
  </td>
</tr>`.trim();
}

function buildEmailFooter(brand: EmailBrand): string {
  const { colors, appName, supportEmail, websiteUrl } = brand;
  const year = new Date().getFullYear();
  const safeName = escapeEmailHtml(appName);
  const safeSupport = escapeEmailHtml(supportEmail);
  const footerMuted = colors.textOnDark;
  return `
<tr>
  <td style="padding:28px 24px 32px;background:${colors.primary};text-align:center;font-family:${EMAIL_FONT_FAMILY};">
    <p style="margin:0 0 10px;font-size:15px;font-weight:600;font-family:${EMAIL_FONT_FAMILY};color:${footerMuted};">${safeName}</p>
    <p style="margin:0 0 14px;font-size:13px;line-height:1.55;font-family:${EMAIL_FONT_FAMILY};color:${footerMuted};">
      Une question ? Écrivez-nous à
      <a href="mailto:${safeSupport}" style="color:${colors.accentLight};text-decoration:none;font-weight:600;">${safeSupport}</a>
    </p>
    ${websiteUrl ? `<p style="margin:0 0 16px;font-size:13px;font-family:${EMAIL_FONT_FAMILY};"><a href="${websiteUrl.replace(/"/g, '&quot;')}" style="color:${colors.accentLight};text-decoration:none;font-weight:600;">Visiter le site</a></p>` : ''}
    <p style="margin:0;font-size:12px;line-height:1.5;font-family:${EMAIL_FONT_FAMILY};color:${footerMuted};">
      © ${year} ${safeName}. Tous droits réservés.
    </p>
    <p style="margin:10px 0 0;font-size:12px;line-height:1.5;font-family:${EMAIL_FONT_FAMILY};color:${footerMuted};">
      Vous recevez ce message car il concerne votre compte ou une action sur la plateforme.
    </p>
  </td>
</tr>`.trim();
}

/**
 * Enveloppe HTML complète (header + corps + footer) compatible clients mail.
 */
export function wrapEmailHtml(
  brand: EmailBrand,
  bodyHtml: string,
  options?: WrapEmailOptions,
): string {
  const { colors } = brand;
  const title = escapeEmailHtml(
    options?.title?.trim() || brand.appName,
  );
  const preheader = options?.preheader?.trim()
    ? escapeEmailHtml(options.preheader)
    : '';

  const preheaderBlock = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${colors.background};">${preheader}</div>`
    : '';

  const jsonLdBlock = options?.jsonLd
    ? renderJsonLdBlocks(options.jsonLd)
    : '';

  /** Secours si le client mail retire les scripts du `<head>`. */
  const jsonLdBodyBlock = options?.jsonLd
    ? `<div aria-hidden="true" style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${renderJsonLdBlocks(options.jsonLd)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="fr" ${LAYOUT_MARKER}>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${title}</title>
  ${jsonLdBlock}
</head>
<body style="margin:0;padding:0;background-color:${colors.background};-webkit-text-size-adjust:100%;">
  ${preheaderBlock}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${colors.background};">
    <tr>
      <td align="center" style="padding:28px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:${colors.card};border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(57,40,0,0.08);">
          ${buildEmailHeader(brand)}
          <tr>
            <td style="padding:32px 28px 28px;font-family:${EMAIL_FONT_FAMILY};">
              ${bodyHtml.trim()}
            </td>
          </tr>
          ${buildEmailFooter(brand)}
        </table>
      </td>
    </tr>
  </table>
  ${jsonLdBodyBlock}
</body>
</html>`.trim();
}
