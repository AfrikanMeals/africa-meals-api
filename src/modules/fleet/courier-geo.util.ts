/**
 * Parse le résultat ioredis `GEOSEARCH … WITHDIST` :
 * `[member, distKmAsString]` répétés, ou tableau de paires.
 */
export function parseGeoSearchWithDist(
  raw: unknown,
): Array<{ member: string; distanceKm: number }> {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const out: Array<{ member: string; distanceKm: number }> = [];

  // Forme [ [member, dist], ... ]
  if (Array.isArray(raw[0])) {
    for (const row of raw) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const member = String(row[0] ?? '').trim();
      const distanceKm = Number(row[1]);
      if (!member || !Number.isFinite(distanceKm)) continue;
      out.push({ member, distanceKm });
    }
    return out;
  }

  // Forme flat [member, dist, member, dist, ...]
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const member = String(raw[i] ?? '').trim();
    const distanceKm = Number(raw[i + 1]);
    if (!member || !Number.isFinite(distanceKm)) continue;
    out.push({ member, distanceKm });
  }
  return out;
}

export function isValidWgs84(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}
