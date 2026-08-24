/**
 * Métriques pures livreur — taux d’acceptation, score perf, coût dispatch enrichi.
 */

export type CourierPerformanceCounters = {
  offersPresented?: number;
  offersAccepted?: number;
  offersRejected?: number;
  offersExpired?: number;
  marketplaceNotified?: number;
  marketplaceClaims?: number;
  marketplaceMissed?: number;
  unassignByCourier?: number;
  /** Abandons après prise restaurant (sous-ensemble de unassignByCourier). */
  unassignAfterStoreCollect?: number;
  unassignByOther?: number;
  completedDeliveries?: number;
  totalDeliveryDurationSec?: number;
  totalDistanceKm?: number;
};

export type CourierPerformanceDerived = {
  acceptanceRate: number | null;
  rejectionCount: number;
  unassignCount: number;
  avgDeliveryDurationSec: number | null;
  avgDistanceKm: number | null;
  /** 0–100 — plus haut = meilleur. */
  performanceScore: number;
};

/** Niveau qualitatif dérivé du score (pas un classement mondial). */
export type CourierPerformanceLevel =
  | 'excellent'
  | 'good'
  | 'needs_improvement';

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) && x > 0 ? Math.trunc(x) : 0;
}

function nFloat(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) && x > 0 ? x : 0;
}

/**
 * Taux d’acceptation sur décisions explicites + expirations (flotte + marketplace claims).
 * null si aucun échantillon.
 */
export function computeCourierAcceptanceRate(
  c: CourierPerformanceCounters,
): number | null {
  const accepted = n(c.offersAccepted) + n(c.marketplaceClaims);
  const rejected = n(c.offersRejected);
  const expired = n(c.offersExpired);
  const missed = n(c.marketplaceMissed);
  const denom = accepted + rejected + expired + missed;
  if (denom <= 0) return null;
  return Math.round((accepted / denom) * 1000) / 1000;
}

export function computeCourierAvgDeliveryDurationSec(
  c: CourierPerformanceCounters,
): number | null {
  const completed = n(c.completedDeliveries);
  const total = n(c.totalDeliveryDurationSec);
  if (completed <= 0 || total <= 0) return null;
  return Math.round(total / completed);
}

export function computeCourierAvgDistanceKm(
  c: CourierPerformanceCounters,
): number | null {
  const completed = n(c.completedDeliveries);
  const total = nFloat(c.totalDistanceKm);
  if (completed <= 0 || total <= 0) return null;
  return Math.round((total / completed) * 100) / 100;
}

/**
 * Points de pénalité score (0–25) : 5 / abandon + 10 extra si post-collect.
 */
export function courierAbandonPenaltyPoints(
  c: CourierPerformanceCounters,
): number {
  const unassignCourier = n(c.unassignByCourier);
  const unassignAfterCollect = n(c.unassignAfterStoreCollect);
  return Math.min(25, unassignCourier * 5 + unassignAfterCollect * 10);
}

/**
 * Score 0–100 : acceptance (55) + faible abandon (25) + volume completed (20).
 * Nouveau livreur (pas d’échantillon) → 70 (neutre-positif).
 */
export function computeCourierPerformanceScore(
  c: CourierPerformanceCounters,
): number {
  const acceptance = computeCourierAcceptanceRate(c);
  const completed = n(c.completedDeliveries);

  // Une offre seulement présentée/notifiée n’est pas encore une décision :
  // elle ne doit pas dégrader le score neutre d’un nouveau livreur.
  if (acceptance == null && completed === 0) {
    return 70;
  }

  const acceptPart = (acceptance ?? 0.7) * 55;
  // Post-collect : +10 pts en plus du *5 déjà compté dans unassignByCourier.
  const abandonPenalty = courierAbandonPenaltyPoints(c);
  const abandonPart = 25 - abandonPenalty;
  const volumePart = Math.min(20, completed * 2);

  return Math.max(
    0,
    Math.min(100, Math.round(acceptPart + abandonPart + volumePart)),
  );
}

export function deriveCourierPerformance(
  c: CourierPerformanceCounters,
): CourierPerformanceDerived {
  return {
    acceptanceRate: computeCourierAcceptanceRate(c),
    rejectionCount: n(c.offersRejected),
    unassignCount: n(c.unassignByCourier) + n(c.unassignByOther),
    avgDeliveryDurationSec: computeCourierAvgDeliveryDurationSec(c),
    avgDistanceKm: computeCourierAvgDistanceKm(c),
    performanceScore: computeCourierPerformanceScore(c),
  };
}

/**
 * Niveau UI à partir du score 0–100.
 * excellent ≥ 85 · good ≥ 70 · sinon needs_improvement.
 */
export function computeCourierPerformanceLevel(
  performanceScore: number,
): CourierPerformanceLevel {
  const score = Math.max(0, Math.min(100, Number(performanceScore) || 0));
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  return 'needs_improvement';
}

/**
 * Taux de refus explicites sur le même dénominateur que l’acceptance.
 * null si aucun échantillon.
 */
export function computeCourierRejectionRate(
  c: CourierPerformanceCounters,
): number | null {
  const accepted = n(c.offersAccepted) + n(c.marketplaceClaims);
  const rejected = n(c.offersRejected);
  const expired = n(c.offersExpired);
  const missed = n(c.marketplaceMissed);
  const denom = accepted + rejected + expired + missed;
  if (denom <= 0) return null;
  return Math.round((rejected / denom) * 1000) / 1000;
}

/**
 * Pénalité dispatch (plus haut = pire) à partir du score perf 0–100.
 * Score 100 → 0 ; score 0 → maxPenalty.
 */
export function performanceDispatchPenalty(
  performanceScore: number,
  maxPenalty = 25,
): number {
  const score = Math.max(0, Math.min(100, Number(performanceScore) || 0));
  return Math.round(((100 - score) / 100) * maxPenalty * 100) / 100;
}

/**
 * Pénalité si taux d’acceptation bas (0–1). null → 0.
 */
export function acceptanceDispatchPenalty(
  acceptanceRate: number | null,
  maxPenalty = 20,
): number {
  if (acceptanceRate == null || !Number.isFinite(acceptanceRate)) return 0;
  const rate = Math.max(0, Math.min(1, acceptanceRate));
  return Math.round((1 - rate) * maxPenalty * 100) / 100;
}
