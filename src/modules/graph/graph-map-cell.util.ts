/**
 * Helpers graphe carte (zones / cellules trafic) — Neo4j dérivé.
 * Le routage routeurs reste OSRM / VROOM (pas Neo4j).
 */

/** Zone région pour disponibilité livreur — `region:CM`. */
export function regionAvailabilityZoneId(regionCode: string): string {
  const r = String(regionCode ?? '')
    .trim()
    .toUpperCase();
  return r ? `region:${r}` : 'region:GLOBAL';
}

/**
 * Cellule trafic ~1.1 km (0.01°) — agrégats speed pour prédiction graphe.
 * Pas un réseau routier : OSRM garde le plus court chemin.
 */
export function trafficCellId(latitude: number, longitude: number): string {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
  return `tcell:${Math.round(lat * 100)}_${Math.round(lng * 100)}`;
}

/** Facteur trafic simple depuis vitesse moyenne km/h (ville). */
export function trafficFactorFromAvgSpeedKmh(speedKmh: number): number {
  const s = Number(speedKmh);
  if (!Number.isFinite(s) || s <= 0) return 1;
  // 40 km/h ≈ fluide (1.0) ; 10 km/h ≈ congesté (~1.6)
  const factor = 1 + Math.max(0, (35 - s) / 50);
  return Math.min(2.5, Math.max(0.7, Math.round(factor * 100) / 100));
}
