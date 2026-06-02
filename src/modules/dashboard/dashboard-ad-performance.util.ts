/** Fenêtre d’analyse par défaut pour le score performance Ads du dashboard. */
export const DASHBOARD_AD_PERFORMANCE_DAYS = 30;

/** Impressions minimum pour afficher une note /5 fiable. */
export const DASHBOARD_AD_MIN_IMPRESSIONS_FOR_SCORE = 5;

export type AdPerformanceCounts = {
  impressions: number;
  clicks: number;
  conversions: number;
};

export type DashboardAdPerformancePayload = {
  periodDays: number;
  score: number | null;
  impressions: number;
  clicks: number;
  conversions: number;
  ctrPercent: number | null;
  conversionRatePercent: number | null;
  activeBanners: number;
  activeCampaigns: number;
  trendPercent: number | null;
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pct(n: number, denom: number): number | null {
  if (denom <= 0) return null;
  return round1((n / denom) * 100);
}

/**
 * Note /5 : CTR (max 3 pts) + taux de conversion post-clic (max 2 pts).
 * Références : CTR 5 %+ et conv. clic 8 %+ ≈ excellent.
 */
export function computeAdPerformanceScore5(
  counts: AdPerformanceCounts,
): number | null {
  const impressions = Math.max(0, counts.impressions);
  const clicks = Math.max(0, counts.clicks);
  const conversions = Math.max(0, counts.conversions);
  if (impressions < DASHBOARD_AD_MIN_IMPRESSIONS_FOR_SCORE) {
    return null;
  }
  const ctr = clicks / impressions;
  const convOnClicks = conversions / Math.max(1, clicks);
  const ctrPts = Math.min(3, (ctr / 0.05) * 3);
  const convPts = Math.min(2, (convOnClicks / 0.08) * 2);
  return round1(Math.min(5, Math.max(0, ctrPts + convPts)));
}

export function buildDashboardAdPerformancePayload(input: {
  current: AdPerformanceCounts;
  previous: AdPerformanceCounts;
  activeBanners: number;
  activeCampaigns: number;
  periodDays?: number;
}): DashboardAdPerformancePayload {
  const periodDays = input.periodDays ?? DASHBOARD_AD_PERFORMANCE_DAYS;
  const score = computeAdPerformanceScore5(input.current);
  const prevScore = computeAdPerformanceScore5(input.previous);
  let trendPercent: number | null = null;
  if (score != null && prevScore != null && prevScore > 0) {
    trendPercent = round1(((score - prevScore) / prevScore) * 100);
  }

  return {
    periodDays,
    score,
    impressions: input.current.impressions,
    clicks: input.current.clicks,
    conversions: input.current.conversions,
    ctrPercent: pct(input.current.clicks, input.current.impressions),
    conversionRatePercent: pct(
      input.current.conversions,
      Math.max(1, input.current.clicks),
    ),
    activeBanners: input.activeBanners,
    activeCampaigns: input.activeCampaigns,
    trendPercent,
  };
}
