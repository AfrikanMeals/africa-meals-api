import type { ConfigService } from '@nestjs/config';
import type { SecretManagerService } from '@modules/secret-manager/secret-manager.service';

const DEFAULT_MAPBOX_GEOCODE_URL =
  'https://api.mapbox.com/search/geocode/v6/forward';

export function readMapboxEnvToken(
  config: ConfigService | undefined,
  key: string,
): string {
  return String(config?.get<string>(key) ?? process.env[key] ?? '').trim();
}

/** Préfère un token public (pk.) — requis pour Geocoding si le secret (sk.) n’a pas ce scope. */
export function pickMapboxGeocodingToken(tokens: string[]): string {
  const normalized = tokens.map((t) => t.trim()).filter(Boolean);
  const pk = normalized.find((t) => t.startsWith('pk.'));
  if (pk) return pk;
  return normalized[0] ?? '';
}

export function resolveMapboxGeocodingTokenFromEnv(
  config?: ConfigService,
): string {
  return pickMapboxGeocodingToken([
    readMapboxEnvToken(config, 'MAPBOX_PUBLIC_ACCESS_TOKEN'),
    readMapboxEnvToken(config, 'MAPBOX_ACCESS_TOKEN'),
    readMapboxEnvToken(config, 'NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN'),
  ]);
}

export async function resolveMapboxGeocodingToken(
  secrets: SecretManagerService,
  config?: ConfigService,
): Promise<string> {
  const [publicDb, accessDb] = await Promise.all([
    secrets.resolveString('api', 'MAPBOX_PUBLIC_ACCESS_TOKEN'),
    secrets.resolveString('api', 'MAPBOX_ACCESS_TOKEN'),
  ]);
  return pickMapboxGeocodingToken([
    publicDb,
    accessDb,
    readMapboxEnvToken(config, 'MAPBOX_PUBLIC_ACCESS_TOKEN'),
    readMapboxEnvToken(config, 'MAPBOX_ACCESS_TOKEN'),
    readMapboxEnvToken(config, 'NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN'),
  ]);
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
  const trimmed = token.trim();
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
        ? 'HTTP 403 — token secret (sk.) sans scope Geocoding ; utiliser MAPBOX_PUBLIC_ACCESS_TOKEN (pk.)'
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
