import type { ConfigService } from '@nestjs/config';
import type { SecretManagerService } from '@modules/secret-manager/secret-manager.service';

const DEFAULT_MAPBOX_GEOCODE_URL =
  'https://api.mapbox.com/search/geocode/v6/forward';

export function readMapboxEnvToken(
  config: ConfigService | undefined,
  key: string,
): string {
  return normalizeMapboxTokenString(
    String(config?.get<string>(key) ?? process.env[key] ?? ''),
  );
}

/** Retire guillemets et espaces (copier-coller .env / kubectl --from-env-file). */
export function normalizeMapboxTokenString(raw: string): string {
  let t = String(raw ?? '').trim();
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("'") && t.endsWith("'"))
  ) {
    t = t.slice(1, -1);
  }
  return t.replace(/\s+/g, '');
}

/** Ne jamais exposer un token secret (sk.) ni une valeur non pk. aux clients. */
export function sanitizeMapboxPublicAccessToken(raw: string): string {
  const t = normalizeMapboxTokenString(raw);
  if (!t || t.startsWith('sk.')) return '';
  if (!t.startsWith('pk.')) return '';
  return t;
}

/** Token serveur (MAPBOX_ACCESS_TOKEN) — géocodage API uniquement, jamais le pk. public frontend. */
export function resolveMapboxServerTokenFromEnv(
  config?: ConfigService,
): string {
  return readMapboxEnvToken(config, 'MAPBOX_ACCESS_TOKEN');
}

/** Token public (pk.) — tuiles / Directions admin & mobile via GET /platform/map-settings. */
export async function resolveMapboxPublicAccessToken(
  secrets: SecretManagerService,
  config?: ConfigService,
): Promise<string> {
  const fromDb = await secrets.resolveString(
    'api',
    'MAPBOX_PUBLIC_ACCESS_TOKEN',
  );
  const fromEnv = readMapboxEnvToken(config, 'MAPBOX_PUBLIC_ACCESS_TOKEN');
  return sanitizeMapboxPublicAccessToken(fromDb || fromEnv);
}

export async function resolveMapboxGeocodingToken(
  secrets: SecretManagerService,
  config?: ConfigService,
): Promise<string> {
  const fromDb = await secrets.resolveString('api', 'MAPBOX_ACCESS_TOKEN');
  return resolveMapboxServerTokenFromEnv(config) || fromDb.trim();
}

export function resolveMapboxGeocodeApiUrl(config?: ConfigService): string {
  return (
    readMapboxEnvToken(config, 'MAP_BOX_API_URL') || DEFAULT_MAPBOX_GEOCODE_URL
  );
}

export async function probeMapboxGeocodingApi(
  token: string,
  apiUrl?: string,
): Promise<{ ok: boolean; message: string; details?: string }> {
  const trimmed = normalizeMapboxTokenString(token);
  if (!trimmed) {
    return { ok: false, message: 'non configuré' };
  }

  const base = apiUrl?.trim() || DEFAULT_MAPBOX_GEOCODE_URL;
  try {
    const url = new URL(base);
    url.searchParams.set('q', 'Montreal');
    url.searchParams.set('limit', '1');
    url.searchParams.set('access_token', trimmed);
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(7000),
    });
    if (res.ok) {
      return { ok: true, message: 'joignable' };
    }

    let details = `HTTP ${res.status}`;
    if (res.status === 403) {
      details = trimmed.startsWith('sk.')
        ? 'HTTP 403 — vérifier scopes Geocoding sur le token secret (MAPBOX_ACCESS_TOKEN)'
        : 'HTTP 403 — token refusé (scopes Geocoding ou restrictions URL)';
    }
    return {
      ok: false,
      message: 'non valide',
      details,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : String(e),
    };
  }
}
