function normalizeCorsOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '');
}

/** Sous-domaines Wise Eat (admin, vitrine, api-dev, ws-dev, previews Firebase, etc.). */
export const WISE_EAT_CORS_PATTERNS = [
  'https://*.wise-eat.com',
  'http://*.wise-eat.com',
] as const;

export function corsOriginMatchesPattern(
  origin: string,
  pattern: string,
): boolean {
  const o = normalizeCorsOrigin(origin);
  const p = normalizeCorsOrigin(pattern);
  if (!p.includes('*')) {
    return o === p;
  }

  let originUrl: URL;
  try {
    originUrl = new URL(o);
  } catch {
    return false;
  }

  const host = originUrl.hostname.toLowerCase();

  const httpsWildcard = p.match(/^https:\/\/\*\.(.+)$/i);
  if (httpsWildcard) {
    const base = httpsWildcard[1].toLowerCase();
    if (originUrl.protocol !== 'https:') return false;
    return host === base || host.endsWith(`.${base}`);
  }

  const httpWildcard = p.match(/^http:\/\/\*\.(.+)$/i);
  if (httpWildcard) {
    const base = httpWildcard[1].toLowerCase();
    if (originUrl.protocol !== 'http:') return false;
    return host === base || host.endsWith(`.${base}`);
  }

  const anyScheme = p.match(/^\*\.(.+)$/i);
  if (anyScheme) {
    const base = anyScheme[1].toLowerCase();
    return host === base || host.endsWith(`.${base}`);
  }

  return false;
}

export function isCorsOriginAllowed(
  origin: string,
  exactAllowed: Set<string>,
  patterns: readonly string[] = WISE_EAT_CORS_PATTERNS,
): boolean {
  const normalized = normalizeCorsOrigin(origin);
  if (exactAllowed.has(normalized)) return true;
  for (const pattern of patterns) {
    if (corsOriginMatchesPattern(normalized, pattern)) return true;
  }
  for (const pattern of exactAllowed) {
    if (pattern.includes('*') && corsOriginMatchesPattern(normalized, pattern)) {
      return true;
    }
  }
  return false;
}
