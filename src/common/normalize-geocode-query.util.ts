/** Abréviations courantes FR/EN → forme développée (clé normalisée sans ponctuation). */
const ABBREVIATIONS: Record<string, string> = {
  st: 'street',
  'st.': 'street',
  str: 'street',
  ave: 'avenue',
  'ave.': 'avenue',
  av: 'avenue',
  'av.': 'avenue',
  blvd: 'boulevard',
  'blvd.': 'boulevard',
  boul: 'boulevard',
  bd: 'boulevard',
  rd: 'road',
  'rd.': 'road',
  rte: 'route',
  dr: 'drive',
  'dr.': 'drive',
  ln: 'lane',
  'ln.': 'lane',
  ct: 'court',
  'ct.': 'court',
  apt: 'apartment',
  app: 'appartement',
  ste: 'suite',
  ch: 'chemin',
  imp: 'impasse',
  pl: 'place',
  'pl.': 'place',
};

export const GEOCODE_MIN_QUERY_LENGTH = 3;

export function normalizeCountryCode(raw?: string | null): string {
  const cc = String(raw ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  return /^[A-Z]{2}$/.test(cc) ? cc : '';
}

/**
 * Normalise une requête géocodage pour clé de cache :
 * minuscules, espaces réduits, abréviations développées.
 */
export function normalizeGeocodeQuery(raw: string): string {
  let s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  s = s.replace(/[,;]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const words = s.split(' ').map((word) => {
    const bare = word.replace(/[.]+$/g, '');
    return ABBREVIATIONS[word] ?? ABBREVIATIONS[bare] ?? word;
  });
  return words.join(' ').trim();
}

export type GeocodeCacheKind = 'forward' | 'reverse' | 'structured';

export function buildGeocodeCacheKey(args: {
  kind: GeocodeCacheKind;
  query: string;
  countryCode: string;
  limit?: number;
  proximity?: string;
  bbox?: string;
}): string {
  const norm = normalizeGeocodeQuery(args.query);
  const cc = normalizeCountryCode(args.countryCode) || 'XX';
  const limit = Number.isFinite(args.limit) ? Math.trunc(args.limit!) : 5;
  const prox = String(args.proximity ?? '').trim();
  const bbox = String(args.bbox ?? '').trim();
  // pin2 : invalide le cache des centroïdes de rue (précision rooftop 2026-08-26).
  const pin = args.kind === 'forward' ? '|pin2' : '';
  return `${args.kind}|${norm}|${cc}|${limit}|${prox}|${bbox}${pin}`;
}

export function normalizePostalCode(raw?: string | null): string {
  return String(raw ?? '')
    .replace(/\s+/g, '')
    .toLowerCase();
}
