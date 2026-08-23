/**
 * Parse le locator Google Maps collé en admin.
 * Deux formats Quick Builder : iframe GCS, ou page HTML Locator Plus
 * (`CONFIGURATION` + `gmpx-store-locator`).
 * On ne persiste jamais le HTML brut (XSS).
 */

export const LOCATOR_EMBED_MAX_CHARS = 20000;

/** Library ECL officielle — URL figée, jamais celle du HTML collé. */
export const LOCATOR_PLUS_ECL_SCRIPT =
  'https://ajax.googleapis.com/ajax/libs/@googlemaps/extended-component-library/0.6.11/index.min.js';

const LOCATOR_PLUS_SOLUTION_CHANNEL = 'GMP_QB_locatorplus_v11_cABCDE';
const DEFAULT_MAP_ID = 'DEMO_MAP_ID';
const MAPS_API_KEY_RE = /^AIza[0-9A-Za-z_-]{20,50}$/;
const MAP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PLACE_ID_RE = /^[A-Za-z0-9_,.:+/=-]{0,500}$/;
const MAX_LOCATIONS = 50;
const MAX_LABEL = 200;

const IFRAME_SRC_RE = /<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/i;
const GMPX_KEY_RE = /<gmpx-api-loader\b[^>]*\bkey\s*=\s*["']([^"']+)["']/i;
const GMPX_MAP_ID_RE = /<gmpx-store-locator\b[^>]*\bmap-id\s*=\s*["']([^"']+)["']/i;

const ALLOWED_HOSTS = new Set([
  'storage.googleapis.com',
  'www.google.com',
  'google.com',
  'maps.google.com',
  'maps.googleapis.com',
]);

const CAPABILITY_KEYS = [
  'input',
  'autocomplete',
  'directions',
  'distanceMatrix',
  'details',
  'actions',
] as const;

export type LocatorPlusLocation = {
  title: string;
  address1: string;
  address2: string;
  coords: { lat: number; lng: number };
  placeId?: string;
};

export type LocatorPlusConfig = {
  mapsApiKey: string;
  mapId: string;
  configuration: {
    locations: LocatorPlusLocation[];
    mapOptions: Record<string, unknown>;
    mapsApiKey: string;
    capabilities: Record<string, boolean>;
  };
};

export type LocatorEmbedParseResult =
  | { kind: 'iframe'; src: string }
  | { kind: 'locatorPlus'; config: LocatorPlusConfig };

/**
 * Parse iframe GCS **ou** HTML Locator Plus Quick Builder.
 * Vide → `null` (effacement). Invalide → `undefined`.
 */
export function parseLocatorEmbed(
  raw: unknown,
): LocatorEmbedParseResult | null | undefined {
  if (raw == null) return undefined;
  const text = String(raw).trim();
  if (!text) return null;
  if (text.length > LOCATOR_EMBED_MAX_CHARS) return undefined;
  // 1. Page Locator Plus (CONFIGURATION + web component).
  if (looksLikeLocatorPlusHtml(text)) {
    const config = parseLocatorPlusHtml(text);
    return config ? { kind: 'locatorPlus', config } : undefined;
  }
  // 2. Iframe / URL HTTPS allowlistée (export « Intégrer à votre site »).
  const src = extractSrcCandidate(text);
  if (src && isAllowedLocatorSrc(src)) {
    return { kind: 'iframe', src };
  }
  return undefined;
}

/**
 * Extraie uniquement une src iframe (rétrocompat callers iframe).
 * Vide → `null`. Invalide / Locator Plus → `undefined`.
 */
export function parseLocatorEmbedSrc(
  raw: unknown,
): string | null | undefined {
  if (raw == null) return undefined;
  const text = String(raw).trim();
  if (!text) return null;
  const parsed = parseLocatorEmbed(raw);
  if (parsed === null) return null;
  if (parsed?.kind === 'iframe') return parsed.src;
  return undefined;
}

/** Iframe canonique pour réafficher le champ admin à partir de la src stockée. */
export function buildLocatorIframeHtml(src: string): string {
  const safe = String(src ?? '').trim();
  if (!safe || !isAllowedLocatorSrc(safe)) return '';
  return `<iframe src="${escapeHtmlAttr(safe)}" width="100%" height="100%" style="border:0;" loading="lazy"></iframe>`;
}

/**
 * Reconstruit une page Locator Plus canonique (script ECL figé, JSON échappé).
 * Sert à réafficher le textarea admin — pas à l’injecter en innerHTML public.
 */
export function buildLocatorPlusHtml(config: LocatorPlusConfig): string {
  const safe = sanitizeLocatorPlusConfig(config);
  if (!safe) return '';
  const json = JSON.stringify(safe.configuration).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html>
  <head>
    <title>Locator</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <script>
      const CONFIGURATION = ${json};
    </script>
    <script type="module">
      document.addEventListener('DOMContentLoaded', async () => {
        await customElements.whenDefined('gmpx-store-locator');
        const locator = document.querySelector('gmpx-store-locator');
        locator.configureFromQuickBuilder(CONFIGURATION);
      });
    </script>
  </head>
  <body>
    <script type="module" src="${LOCATOR_PLUS_ECL_SCRIPT}"></script>
    <gmpx-api-loader key="${escapeHtmlAttr(safe.mapsApiKey)}" solution-channel="${LOCATOR_PLUS_SOLUTION_CHANNEL}"></gmpx-api-loader>
    <gmpx-store-locator map-id="${escapeHtmlAttr(safe.mapId)}"></gmpx-store-locator>
  </body>
</html>`;
}

/** HTML admin à réafficher : Locator Plus si config, sinon iframe. */
export function buildLocatorAdminHtml(
  src?: string,
  config?: LocatorPlusConfig | null,
): string {
  if (config) {
    const html = buildLocatorPlusHtml(config);
    if (html) return html;
  }
  return buildLocatorIframeHtml(String(src ?? '').trim());
}

export function sanitizeLocatorPlusConfig(
  raw: unknown,
): LocatorPlusConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const input = raw as Record<string, unknown>;
  const configurationRaw =
    input.configuration && typeof input.configuration === 'object'
      ? (input.configuration as Record<string, unknown>)
      : input;
  const mapsApiKey = pickMapsApiKey(
    input.mapsApiKey,
    configurationRaw.mapsApiKey,
  );
  if (!mapsApiKey) return undefined;
  const mapIdRaw = String(
    input.mapId ?? configurationRaw.mapId ?? DEFAULT_MAP_ID,
  ).trim();
  const mapId = MAP_ID_RE.test(mapIdRaw) ? mapIdRaw : DEFAULT_MAP_ID;
  const locations = sanitizeLocations(configurationRaw.locations);
  if (!locations.length) return undefined;
  const configuration = {
    locations,
    mapOptions: sanitizeMapOptions(configurationRaw.mapOptions),
    mapsApiKey,
    capabilities: sanitizeCapabilities(configurationRaw.capabilities),
  };
  return { mapsApiKey, mapId, configuration };
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
    return (
      /\/maps-solutions-/i.test(url.pathname) || /locator-plus/i.test(url.pathname)
    );
  }
  if (
    host === 'www.google.com' ||
    host === 'google.com' ||
    host === 'maps.google.com'
  ) {
    return url.pathname.startsWith('/maps');
  }
  return true;
}

function looksLikeLocatorPlusHtml(text: string): boolean {
  return (
    /(?:const|let|var)\s+CONFIGURATION\s*=/.test(text) ||
    /<gmpx-store-locator\b/i.test(text) ||
    /configureFromQuickBuilder\s*\(/.test(text)
  );
}

function parseLocatorPlusHtml(text: string): LocatorPlusConfig | undefined {
  const objectLiteral = extractConfigurationObject(text);
  if (!objectLiteral) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(objectLiteral);
  } catch {
    return undefined;
  }
  const loaderKey = firstMatch(text, GMPX_KEY_RE);
  const mapId = firstMatch(text, GMPX_MAP_ID_RE) || DEFAULT_MAP_ID;
  return sanitizeLocatorPlusConfig({
    mapsApiKey: loaderKey,
    mapId,
    configuration: parsed,
  });
}

function pickMapsApiKey(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    const key = String(candidate ?? '').trim();
    if (MAPS_API_KEY_RE.test(key)) return key;
  }
  return undefined;
}

function sanitizeLocations(raw: unknown): LocatorPlusLocation[] {
  if (!Array.isArray(raw)) return [];
  const out: LocatorPlusLocation[] = [];
  for (const item of raw.slice(0, MAX_LOCATIONS)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const coordsRaw = row.coords as Record<string, unknown> | undefined;
    const lat = Number(coordsRaw?.lat);
    const lng = Number(coordsRaw?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const location: LocatorPlusLocation = {
      title: sanitizeLabel(row.title),
      address1: sanitizeLabel(row.address1),
      address2: sanitizeLabel(row.address2),
      coords: { lat, lng },
    };
    const placeId = String(row.placeId ?? '').trim();
    if (placeId && PLACE_ID_RE.test(placeId)) location.placeId = placeId;
    out.push(location);
  }
  return out;
}

function sanitizeMapOptions(raw: unknown): Record<string, unknown> {
  const src =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const centerRaw = src.center as Record<string, unknown> | undefined;
  const lat = Number(centerRaw?.lat);
  const lng = Number(centerRaw?.lng);
  const center =
    Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng }
      : { lat: 0, lng: 0 };
  const zoom = Number(src.zoom);
  const maxZoom = Number(src.maxZoom);
  const mapIdRaw = String(src.mapId ?? '').trim();
  return {
    center,
    fullscreenControl: src.fullscreenControl !== false,
    mapTypeControl: Boolean(src.mapTypeControl),
    streetViewControl: Boolean(src.streetViewControl),
    zoom: Number.isFinite(zoom) ? zoom : 4,
    zoomControl: src.zoomControl !== false,
    maxZoom: Number.isFinite(maxZoom) ? maxZoom : 17,
    mapId: MAP_ID_RE.test(mapIdRaw) ? mapIdRaw : '',
  };
}

function sanitizeCapabilities(raw: unknown): Record<string, boolean> {
  const src =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out: Record<string, boolean> = {};
  for (const key of CAPABILITY_KEYS) {
    out[key] = Boolean(src[key]);
  }
  return out;
}

function sanitizeLabel(value: unknown): string {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F]/g, '')
    .trim()
    .slice(0, MAX_LABEL);
}

function extractConfigurationObject(text: string): string | null {
  const marker = text.match(/(?:const|let|var)\s+CONFIGURATION\s*=\s*\{/);
  if (!marker || marker.index == null) return null;
  const start = text.indexOf('{', marker.index);
  return extractBalancedObject(text, start);
}

function extractBalancedObject(source: string, startIdx: number): string | null {
  if (startIdx < 0 || source[startIdx] !== '{') return null;
  let depth = 0;
  let inStr = false;
  let quote = '';
  let escape = false;
  for (let i = startIdx; i < source.length; i++) {
    const ch = source[i];
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(startIdx, i + 1);
    }
  }
  return null;
}

function firstMatch(text: string, re: RegExp): string {
  const match = text.match(re);
  return match?.[1] ? decodeHtmlEntities(match[1]).trim() : '';
}

function extractSrcCandidate(text: string): string | null {
  const iframeMatch = text.match(IFRAME_SRC_RE);
  const candidate = iframeMatch ? iframeMatch[1] : text;
  const decoded = decodeHtmlEntities(candidate).trim();
  return decoded || null;
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
