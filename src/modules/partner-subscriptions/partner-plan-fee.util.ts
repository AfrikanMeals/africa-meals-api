import { PlanRegionOrderCommissionModel } from '@schemas/plan-region-order-commission.schema';

/**
 * Montant commission / fee à partir d’une ligne plan (fixed|percent).
 * Base = montant métier (commande, GMV, gain livreur) dans la même unité majeure.
 */
export function computePartnerPlanFeeAmount(
  row:
    | Partial<
        Pick<
          PlanRegionOrderCommissionModel,
          | 'mode'
          | 'fixed'
          | 'percent'
          | 'fallbackMode'
          | 'fallbackFixed'
          | 'fallbackPercent'
        >
      >
    | null
    | undefined,
  baseAmount: number,
): {
  amount: number;
  feeMode: 'fixed' | 'percent';
  feeFixed: number;
  feePercent: number;
} {
  const base = Math.max(0, Number(baseAmount) || 0);
  if (!row) {
    return { amount: 0, feeMode: 'percent', feeFixed: 0, feePercent: 0 };
  }

  // Prefer fallback* (barème simple) puis legacy mode/fixed/percent.
  const modeRaw =
    row.fallbackMode === 'fixed' || row.fallbackMode === 'percent'
      ? row.fallbackMode
      : row.mode === 'fixed'
        ? 'fixed'
        : 'percent';
  const feeFixed =
    row.fallbackFixed != null && Number(row.fallbackFixed) > 0
      ? Math.max(0, Number(row.fallbackFixed))
      : Math.max(0, Number(row.fixed ?? 0));
  const feePercent =
    row.fallbackPercent != null && Number(row.fallbackPercent) > 0
      ? Math.max(0, Number(row.fallbackPercent))
      : Math.max(0, Number(row.percent ?? 0));

  if (modeRaw === 'fixed') {
    return {
      amount: Math.round(feeFixed * 100) / 100,
      feeMode: 'fixed',
      feeFixed,
      feePercent: 0,
    };
  }

  const amount = Math.round(((base * feePercent) / 100) * 100) / 100;
  return {
    amount,
    feeMode: 'percent',
    feeFixed: 0,
    feePercent,
  };
}

/** Trouve la ligne régionale (ISO2) dans une liste plan. */
export function findPartnerPlanRegionRow<
  T extends { regionCode?: string },
>(rows: T[] | undefined, regionCode: string | null | undefined): T | undefined {
  const code = String(regionCode ?? '')
    .trim()
    .toUpperCase();
  if (!code || !Array.isArray(rows)) return undefined;
  return rows.find(
    (r) =>
      String(r.regionCode ?? '')
        .trim()
        .toUpperCase() === code,
  );
}

/**
 * Normalise les jours de rappel essai (entiers uniques 1–90, triés desc).
 */
export function normalizePartnerTrialReminderDays(
  days: number[] | undefined,
  trialDays: number,
): number[] {
  if (!trialDays || trialDays <= 0 || !Array.isArray(days)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const raw of days) {
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 1 || n > 90 || n >= trialDays) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out.sort((a, b) => b - a);
}
