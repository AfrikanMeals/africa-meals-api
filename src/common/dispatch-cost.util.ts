/**
 * Score de coût dispatch — Find → Nearest → Available → Workload → Route → Delay.
 * Plus bas = meilleur candidat. Soft ranking (avant / fallback VROOM).
 */

export type DispatchCostWeights = {
  /** Coût par km de distance boutique. */
  distanceKm: number;
  /** Coût × ratio charge (active/capacity) × 30 min équivalent. */
  workload: number;
  /** Coût par minute de route restante (courses en cours). */
  routeMinutes: number;
  /** Coût par minute de délai prédit (ETA engine). */
  delayMinutes: number;
};

export const DEFAULT_DISPATCH_COST_WEIGHTS: DispatchCostWeights = {
  distanceKm: 1,
  workload: 1,
  routeMinutes: 0.85,
  delayMinutes: 1.15,
};

export type DispatchCostInput = {
  distanceMeters: number | null;
  hasGps: boolean;
  activeOrderCount: number;
  maxConcurrentOrders: number;
  /** Secondes restantes estimées sur les courses actives. */
  routeRemainingSeconds?: number | null;
  /** Minutes de délai prédit (traffic / prep / historique). */
  predictedDelayMinutes?: number | null;
  /**
   * Pénalités soft déjà calculées (acceptance + perf score).
   * Plus haut = pire candidat.
   */
  acceptancePenalty?: number | null;
  performancePenalty?: number | null;
};

export function resolveDispatchCostWeights(
  env: NodeJS.ProcessEnv = process.env,
): DispatchCostWeights {
  const num = (key: string, fallback: number) => {
    const raw = Number(env[key]);
    return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
  };
  return {
    distanceKm: num(
      'DISPATCH_WEIGHT_DISTANCE_KM',
      DEFAULT_DISPATCH_COST_WEIGHTS.distanceKm,
    ),
    workload: num(
      'DISPATCH_WEIGHT_WORKLOAD',
      DEFAULT_DISPATCH_COST_WEIGHTS.workload,
    ),
    routeMinutes: num(
      'DISPATCH_WEIGHT_ROUTE_MIN',
      DEFAULT_DISPATCH_COST_WEIGHTS.routeMinutes,
    ),
    delayMinutes: num(
      'DISPATCH_WEIGHT_DELAY_MIN',
      DEFAULT_DISPATCH_COST_WEIGHTS.delayMinutes,
    ),
  };
}

/**
 * Coût composite — pipeline documenté « every new order ».
 */
export function computeDispatchCost(
  input: DispatchCostInput,
  weights: DispatchCostWeights = DEFAULT_DISPATCH_COST_WEIGHTS,
): number {
  const capacity = Math.max(1, Math.trunc(input.maxConcurrentOrders) || 1);
  const active = Math.max(0, Math.trunc(input.activeOrderCount) || 0);
  const workloadRatio = Math.min(1, active / capacity);

  const distMeters =
    input.distanceMeters != null && Number.isFinite(input.distanceMeters)
      ? Math.max(0, input.distanceMeters)
      : null;
  // Sans GPS : pénalité forte (reste en fin de file).
  const distKm = distMeters != null ? distMeters / 1000 : 80;

  const routeMin =
    input.routeRemainingSeconds != null &&
    Number.isFinite(input.routeRemainingSeconds)
      ? Math.max(0, input.routeRemainingSeconds) / 60
      : 0;

  const delayMin =
    input.predictedDelayMinutes != null &&
    Number.isFinite(input.predictedDelayMinutes)
      ? Math.max(0, input.predictedDelayMinutes)
      : 0;

  const acceptPen =
    input.acceptancePenalty != null && Number.isFinite(input.acceptancePenalty)
      ? Math.max(0, Number(input.acceptancePenalty))
      : 0;
  const perfPen =
    input.performancePenalty != null &&
    Number.isFinite(input.performancePenalty)
      ? Math.max(0, Number(input.performancePenalty))
      : 0;

  let cost =
    weights.distanceKm * distKm +
    weights.workload * workloadRatio * 30 +
    weights.routeMinutes * routeMin +
    weights.delayMinutes * delayMin +
    acceptPen +
    perfPen;

  if (!input.hasGps) {
    cost += 1e6;
  }
  return cost;
}
