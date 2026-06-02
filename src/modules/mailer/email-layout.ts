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
};

export const EMAIL_LAYOUT_ID = 'am-email-layout';
const LAYOUT_MARKER = `id="${EMAIL_LAYOUT_ID}"`;
const SKIP_MARKER = '<!-- email-layout:skip -->';

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
  return `<h${level} style="margin:${margins[level]};font-size:${sizes[level]};font-weight:700;color:${EMAIL_BRAND_DEFAULTS.primary};line-height:1.3;">${safe}</h${level}>`;
}

export function emailParagraph(htmlOrText: string): string {
  return `<p style="margin:0 0 14px;font-size:16px;line-height:1.65;color:${EMAIL_BRAND_DEFAULTS.text};">${htmlOrText}</p>`;
}

export function emailMutedParagraph(htmlOrText: string): string {
  return `<p style="margin:0 0 14px;font-size:14px;line-height:1.55;color:${EMAIL_BRAND_DEFAULTS.textMuted};">${htmlOrText}</p>`;
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
    ? `<img src="${logoUrl.replace(/"/g, '&quot;')}" alt="${safeName}" width="140" height="auto" style="display:block;margin:0 auto 14px;max-width:140px;height:auto;border:0;" />`
    : `<div style="display:inline-block;width:56px;height:56px;line-height:56px;border-radius:14px;background:rgba(255,255,255,0.15);font-size:28px;font-weight:800;color:${colors.textOnDark};margin-bottom:14px;">${safeName.charAt(0).toUpperCase()}</div>`;

  return `
<tr>
  <td align="center" style="padding:32px 24px 28px;background:linear-gradient(135deg,${colors.primary} 0%,${colors.accent} 100%);">
    ${logoBlock}
    <p style="margin:0;font-size:22px;font-weight:700;color:${colors.textOnDark};letter-spacing:-0.02em;">${safeName}</p>
  </td>
</tr>`.trim();
}

function buildEmailFooter(brand: EmailBrand): string {
  const { colors, appName, supportEmail, websiteUrl } = brand;
  const year = new Date().getFullYear();
  const safeName = escapeEmailHtml(appName);
  const safeSupport = escapeEmailHtml(supportEmail);
  return `
<tr>
  <td style="padding:28px 24px 32px;background:${colors.primary};text-align:center;">
    <p style="margin:0 0 10px;font-size:15px;font-weight:600;color:${colors.textOnDark};">${safeName}</p>
    <p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:rgba(253,248,240,0.85);">
      Une question ? Écrivez-nous à
      <a href="mailto:${safeSupport}" style="color:${colors.accentLight};text-decoration:none;font-weight:600;">${safeSupport}</a>
    </p>
    ${websiteUrl ? `<p style="margin:0 0 14px;font-size:13px;"><a href="${websiteUrl.replace(/"/g, '&quot;')}" style="color:${colors.accentLight};text-decoration:none;">Visiter le site</a></p>` : ''}
    <p style="margin:0;font-size:11px;color:rgba(253,248,240,0.55);">
      © ${year} ${safeName}. Tous droits réservés.
    </p>
    <p style="margin:12px 0 0;font-size:11px;color:rgba(253,248,240,0.45);">
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

  return `<!DOCTYPE html>
<html lang="fr" ${LAYOUT_MARKER}>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:${colors.background};-webkit-text-size-adjust:100%;">
  ${preheaderBlock}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${colors.background};">
    <tr>
      <td align="center" style="padding:28px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:${colors.card};border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(57,40,0,0.08);">
          ${buildEmailHeader(brand)}
          <tr>
            <td style="padding:32px 28px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
              ${bodyHtml.trim()}
            </td>
          </tr>
          ${buildEmailFooter(brand)}
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}
