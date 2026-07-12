/** Candidat livreur pour auto-offer flotte boutique. */
export type DeliveryOfferCandidateInput = {
  agentUserId: string;
  /** `hors_ligne` exclu ; sinon éligible si capacité libre. */
  dashboardAvailability?: string | null;
  activeOrderCount: number;
  maxConcurrentOrders: number;
  /** Latitude GPS livreur (null = fin de liste). */
  lastLatitude?: number | null;
  lastLongitude?: number | null;
};

export type RankedDeliveryOfferCandidate = {
  agentUserId: string;
  distanceMeters: number | null;
  hasGps: boolean;
};

/**
 * Distance haversine en mètres entre deux points WGS84.
 * Entrées [lng, lat] comme le helper km projet.
 */
export function haversineMeters(
  fromLngLat: [number, number],
  toLngLat: [number, number],
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const [lon1, lat1] = fromLngLat;
  const [lon2, lat2] = toLngLat;
  const R = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function isAgentAvailableForOffer(
  c: DeliveryOfferCandidateInput,
): boolean {
  if (String(c.dashboardAvailability ?? '').trim() === 'hors_ligne') {
    return false;
  }
  const capacity = Math.max(1, Math.trunc(c.maxConcurrentOrders) || 1);
  const active = Math.max(0, Math.trunc(c.activeOrderCount) || 0);
  return active < capacity;
}

/**
 * Classe les candidats : GPS → distance croissante boutique ; sans GPS en fin.
 */
export function rankDeliveryOfferCandidates(
  candidates: DeliveryOfferCandidateInput[],
  storeLngLat: [number, number] | null,
): RankedDeliveryOfferCandidate[] {
  const eligible = candidates.filter(isAgentAvailableForOffer);
  const withDist = eligible.map((c) => {
    const lat = c.lastLatitude;
    const lng = c.lastLongitude;
    const hasGps =
      lat != null &&
      lng != null &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      storeLngLat != null;
    const distanceMeters = hasGps
      ? haversineMeters(storeLngLat!, [Number(lng), Number(lat)])
      : null;
    return {
      agentUserId: c.agentUserId,
      distanceMeters,
      hasGps: !!hasGps,
    };
  });

  withDist.sort((a, b) => {
    if (a.hasGps !== b.hasGps) return a.hasGps ? -1 : 1;
    if (a.hasGps && b.hasGps) {
      return (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0);
    }
    return a.agentUserId.localeCompare(b.agentUserId);
  });

  return withDist;
}

export function parseOfferTimeoutSec(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 5) return 45;
  return Math.min(300, Math.trunc(n));
}
