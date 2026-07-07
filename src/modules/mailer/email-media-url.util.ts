import {
  isEmailStorageObjectUrl,
  mapEmailObjectPathToWebUrl,
  resolveEmailWebAssetUrl,
} from './email-web-asset-url.util';

const IMG_SRC_RE = /<img\b[^>]*\bsrc=(["'])([^"']+)\1/gi;

/** Détecte une URL objet legacy dans le HTML e-mail. */
export function emailHtmlImageNeedsMediaResolve(url: string): boolean {
  return isEmailStorageObjectUrl(url);
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, '&');
}

function encodeForHtmlAttribute(url: string, quote: string): string {
  if (quote === '"') {
    return url.replace(/"/g, '&quot;');
  }
  return url.replace(/'/g, '&#39;');
}

/** Extrait les URLs http(s) candidates dans le HTML (img, JSON-LD, attributs). */
function collectStorageUrlsInHtml(html: string): Set<string> {
  const found = new Set<string>();
  const patterns = [
    /https?:\/\/[^\s"'<>]+/gi,
    /https?:\\\/\\\/[^"'\\]+/gi,
  ];

  for (const re of patterns) {
    for (const match of html.matchAll(re)) {
      const raw = match[0]
        .replace(/\\u002f/gi, '/')
        .replace(/\\\//g, '/')
        .replace(/\\u0026/gi, '&');
      if (emailHtmlImageNeedsMediaResolve(raw)) {
        found.add(raw);
      }
    }
  }

  for (const match of html.matchAll(IMG_SRC_RE)) {
    const decoded = decodeHtmlAttribute(match[2] ?? '');
    if (emailHtmlImageNeedsMediaResolve(decoded)) {
      found.add(decoded);
    }
  }

  return found;
}

function replaceUrlEverywhere(html: string, from: string, to: string): string {
  if (!from || from === to) return html;
  let out = html.split(from).join(to);
  const escapedSlash = from.replace(/\//g, '\\/');
  if (escapedSlash !== from) {
    out = out.split(escapedSlash).join(to);
  }
  const jsonSlash = from.replace(/\//g, '\\u002f');
  if (jsonSlash !== from) {
    out = out.split(jsonSlash).join(to);
  }
  return out;
}

/**
 * Réécrit toutes les URLs stockage objet dans le HTML e-mail
 * (balises img, JSON-LD, attributs) vers le site vitrine.
 */
export async function resolveAllEmailHtmlStorageUrls(
  html: string,
  resolve: (url: string) => Promise<string | undefined>,
  websiteBase?: string,
): Promise<string> {
  if (!html?.trim()) return html;

  const pending = collectStorageUrlsInHtml(html);
  if (!pending.size) return html;

  const resolvedMap = new Map<string, string>();
  await Promise.all(
    [...pending].map(async (url) => {
      let resolved = (await resolve(url)) ?? url;
      if (
        websiteBase &&
        emailHtmlImageNeedsMediaResolve(resolved) &&
        resolved === url
      ) {
        const web = resolveEmailWebAssetUrl(url, websiteBase);
        if (web) resolved = web;
      }
      resolvedMap.set(url, resolved);
    }),
  );

  let out = html;
  out = out.replace(IMG_SRC_RE, (full, quote, src) => {
    const decoded = decodeHtmlAttribute(src);
    const resolved = resolvedMap.get(decoded);
    if (!resolved || resolved === decoded) return full;
    const safeSrc = encodeForHtmlAttribute(resolved, quote);
    return full.replace(src, safeSrc);
  });

  for (const [from, to] of resolvedMap) {
    if (from !== to) {
      out = replaceUrlEverywhere(out, from, to);
    }
  }

  return out;
}

/** @deprecated Préférer resolveAllEmailHtmlStorageUrls */
export async function resolveEmailHtmlMediaUrls(
  html: string,
  resolve: (url: string) => Promise<string | undefined>,
): Promise<string> {
  return resolveAllEmailHtmlStorageUrls(html, resolve);
}

export { mapEmailObjectPathToWebUrl };
