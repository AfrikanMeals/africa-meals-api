import {
  computeDispatchCost,
  resolveDispatchCostWeights,
  type DispatchCostWeights,
} from '@common/dispatch-cost.util';

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
  /**
   * Distance live Redis GEO (m) — prioritaire sur haversine Mongo
   * `lastLatitude`/`lastLongitude` quand présente.
   */
  geoDistanceMeters?: number | null;
  /** Secondes restantes estimées sur courses actives (polyline / duration). */
  routeRemainingSeconds?: number | null;
  /** Délai prédit (ETA engine) en minutes. */
  predictedDelayMinutes?: number | null;
};

export type RankedDeliveryOfferCandidate = {
  agentUserId: string;
  distanceMeters: number | null;
  hasGps: boolean;
  /** Coût composite dispatch (plus bas = mieux). */
  dispatchCost: number;
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

function resolveDistanceMeters(
  c: DeliveryOfferCandidateInput,
  storeLngLat: [number, number] | null,
): { distanceMeters: number | null; hasGps: boolean } {
  const geoMeters =
    c.geoDistanceMeters != null && Number.isFinite(c.geoDistanceMeters)
      ? Math.max(0, Math.round(Number(c.geoDistanceMeters)))
      : null;
  if (geoMeters != null) {
    return { distanceMeters: geoMeters, hasGps: true };
  }
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
  return { distanceMeters, hasGps: !!hasGps };
}

/**
 * Classe les candidats selon le pipeline dispatch :
 * Find → Available → Nearest + Workload + Current route + Predicted delay.
 * Soft score composite ; VROOM peut réordonner ensuite (fallback intact).
 */
export function rankDeliveryOfferCandidates(
  candidates: DeliveryOfferCandidateInput[],
  storeLngLat: [number, number] | null,
  opts?: { weights?: DispatchCostWeights },
): RankedDeliveryOfferCandidate[] {
  const weights = opts?.weights ?? resolveDispatchCostWeights();
  const eligible = candidates.filter(isAgentAvailableForOffer);
  const withDist = eligible.map((c) => {
    const { distanceMeters, hasGps } = resolveDistanceMeters(c, storeLngLat);
    const dispatchCost = computeDispatchCost(
      {
        distanceMeters,
        hasGps,
        activeOrderCount: c.activeOrderCount,
        maxConcurrentOrders: c.maxConcurrentOrders,
        routeRemainingSeconds: c.routeRemainingSeconds,
        predictedDelayMinutes: c.predictedDelayMinutes,
      },
      weights,
    );
    return {
      agentUserId: c.agentUserId,
      distanceMeters,
      hasGps,
      dispatchCost,
    };
  });

  withDist.sort((a, b) => {
    if (a.dispatchCost !== b.dispatchCost) {
      return a.dispatchCost - b.dispatchCost;
    }
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
