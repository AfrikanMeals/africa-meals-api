export type AdsTargetingScoreInput = {
  interestMatch: number;
  recencyBoost: number;
  engagementScore: number;
  conversionProbability: number;
};

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export function computeAdsTargetingScore(input: AdsTargetingScoreInput): number {
  const interestMatch = clamp01(input.interestMatch);
  const recencyBoost = clamp01(input.recencyBoost);
  const engagementScore = clamp01(input.engagementScore);
  const conversionProbability = clamp01(input.conversionProbability);
  const raw =
    interestMatch * 0.5 +
    recencyBoost * 0.2 +
    engagementScore * 0.2 +
    conversionProbability * 0.1;
  return Number(raw.toFixed(4));
}
