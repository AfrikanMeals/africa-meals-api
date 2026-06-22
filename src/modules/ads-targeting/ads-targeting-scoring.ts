export type AdsTargetingScoreInput = {
  interestMatch: number;
  recencyBoost: number;
  engagementScore: number;
  conversionProbability: number;
  /** Adéquation placement ↔ règles campagne (0–1). */
  placementMatch?: number;
  /** Priorité éditoriale + slot demandé (0–1). */
  positionBoost?: number;
  /** Action / items / segment orientés conversion & livraison (0–1). */
  deliveryConversionBoost?: number;
  /** CTR / conversions passées sur ce placement (0–1). */
  placementPerformance?: number;
  /** Score formule boutique normalisé (0–1). */
  vendorPlanBoost?: number;
};

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function computeAdsTargetingScore(
  input: AdsTargetingScoreInput,
): number {
  const interestMatch = clamp01(input.interestMatch);
  const recencyBoost = clamp01(input.recencyBoost);
  const engagementScore = clamp01(input.engagementScore);
  const conversionProbability = clamp01(input.conversionProbability);
  const placementMatch = clamp01(input.placementMatch ?? 1);
  const positionBoost = clamp01(input.positionBoost ?? 0.5);
  const deliveryConversionBoost = clamp01(
    input.deliveryConversionBoost ?? 0.4,
  );
  const placementPerformance = clamp01(input.placementPerformance ?? 0.45);
  const vendorPlanBoost = clamp01(input.vendorPlanBoost ?? 0);

  const raw =
    interestMatch * 0.32 +
    recencyBoost * 0.1 +
    engagementScore * 0.1 +
    conversionProbability * 0.08 +
    placementMatch * 0.1 +
    positionBoost * 0.1 +
    deliveryConversionBoost * 0.12 +
    placementPerformance * 0.06 +
    vendorPlanBoost * 0.12;

  return Number(raw.toFixed(4));
}
