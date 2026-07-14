/**
 * Pelias (OpenStreetMap geocoder backed by Elasticsearch).
 * API compatible : GET /v1/search?text=…&size=…
 */

export type PeliasGeocodeFeature = {
  id: string;
  place_name: string;
  text: string;
  center: [number, number];
  context?: Array<{ id: string; text: string }>;
};

export function resolvePeliasBaseUrl(env?: {
  get?: (k: string) => string | undefined;
}): string {
  const raw =
    env?.get?.('PELIAS_BASE_URL')?.trim() ||
    process.env.PELIAS_BASE_URL?.trim() ||
    '';
  return raw.replace(/\/+$/, '');
}

export async function peliasForwardGeocode(params: {
  query: string;
  limit?: number;
  countryCode?: string | null;
  baseUrl?: string;
}): Promise<PeliasGeocodeFeature[]> {
  const base = (params.baseUrl ?? resolvePeliasBaseUrl()).replace(/\/+$/, '');
  if (!base) return [];
  const q = params.query.trim();
  if (q.length < 2) return [];
  const size = Math.min(10, Math.max(1, params.limit ?? 5));
  const url = new URL(`${base}/v1/search`);
  url.searchParams.set('text', q);
  url.searchParams.set('size', String(size));
  if (params.countryCode?.trim()) {
    url.searchParams.set(
      'boundary.country',
      params.countryCode.trim().toUpperCase(),
    );
  }
  const res = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    features?: Array<{
      type?: string;
      geometry?: { coordinates?: number[] };
      properties?: {
        id?: string;
        gid?: string;
        label?: string;
        name?: string;
        locality?: string;
        region?: string;
        country?: string;
        postalcode?: string;
      };
    }>;
  };
  const out: PeliasGeocodeFeature[] = [];
  for (const f of json.features ?? []) {
    const coords = f.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const p = f.properties ?? {};
    const place =
      String(p.label ?? '').trim() ||
      [p.name, p.locality, p.region, p.country].filter(Boolean).join(', ');
    if (!place) continue;
    out.push({
      id: String(p.gid ?? p.id ?? `${lng},${lat}`),
      place_name: place,
      text: String(p.name ?? place),
      center: [lng, lat],
      context: [
        p.locality ? { id: 'place', text: p.locality } : null,
        p.region ? { id: 'region', text: p.region } : null,
        p.country ? { id: 'country', text: p.country } : null,
        p.postalcode ? { id: 'postcode', text: p.postalcode } : null,
      ].filter(Boolean) as Array<{ id: string; text: string }>,
    });
  }
  return out;
}
