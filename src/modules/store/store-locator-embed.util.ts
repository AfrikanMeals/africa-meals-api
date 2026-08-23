/**
 * Parse le snippet iframe Google Maps Locator Plus collé en admin.
 * On ne persiste que l’URL `src` HTTPS allowlistée — jamais de HTML brut
 * (évite XSS si un jour le champ est injecté tel quel).
 */

export const LOCATOR_EMBED_MAX_CHARS = 4000;

const IFRAME_SRC_RE = /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i;

const ALLOWED_HOSTS = new Set([
  'storage.googleapis.com',
  'www.google.com',
  'google.com',
  'maps.google.com',
  'maps.googleapis.com',
]);

/**
 * Extraie et valide la src locator depuis un iframe ou une URL nue.
 * Chaîne vide → `null` (effacement). Snippet invalide → `undefined`.
 */
export function parseLocatorEmbedSrc(
  raw: unknown,
): string | null | undefined {
  if (raw == null) return undefined;
  const text = String(raw).trim();
  if (!text) return null;
  if (text.length > LOCATOR_EMBED_MAX_CHARS) return undefined;
  const extracted = extractSrcCandidate(text);
  if (!extracted) return undefined;
  return isAllowedLocatorSrc(extracted) ? extracted : undefined;
}

/** Iframe canonique pour réafficher le champ admin à partir de la src stockée. */
export function buildLocatorIframeHtml(src: string): string {
  const safe = String(src ?? '').trim();
  if (!safe || !isAllowedLocatorSrc(safe)) return '';
  return `<iframe src="${escapeHtmlAttr(safe)}" width="100%" height="100%" style="border:0;" loading="lazy"></iframe>`;
}

function extractSrcCandidate(text: string): string | null {
  const iframeMatch = text.match(IFRAME_SRC_RE);
  const candidate = iframeMatch ? iframeMatch[1] : text;
  const decoded = decodeHtmlEntities(candidate).trim();
  if (!decoded) return null;
  return decoded;
}

export function isAllowedLocatorSrc(src: string): boolean {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) return false;
  // GCS : uniquement les solutions Maps (pas un bucket arbitraire).
  if (host === 'storage.googleapis.com') {
    return /\/maps-solutions-/i.test(url.pathname) || /locator-plus/i.test(url.pathname);
  }
  // Embed Google Maps classique.
  if (host === 'www.google.com' || host === 'google.com' || host === 'maps.google.com') {
    return url.pathname.startsWith('/maps');
  }
  return true;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}
