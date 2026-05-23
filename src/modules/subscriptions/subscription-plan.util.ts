/** Formule gratuite (pas d’essai). */
export function isFreeSubscriptionPlan(plan: {
  name: string;
  priceMonthly: number;
  priceYearly: number;
}): boolean {
  const n = String(plan.name ?? '')
    .trim()
    .toUpperCase();
  return (
    n === 'FREE' ||
    (Number(plan.priceMonthly) === 0 && Number(plan.priceYearly) === 0)
  );
}

/** Jours avant la fin d’essai pour envoyer un rappel (décroissant, uniques, > 0). */
export function normalizeTrialReminderDays(
  raw: number[] | undefined,
  trialDays: number,
): number[] {
  const max = Math.max(0, Math.floor(trialDays));
  if (max <= 0) return [];
  const set = new Set<number>();
  for (const v of raw ?? []) {
    const d = Math.floor(Number(v));
    if (d > 0 && d < max) set.add(d);
  }
  return [...set].sort((a, b) => b - a);
}

export function resolvePlanTrialFields(plan: {
  name: string;
  priceMonthly: number;
  priceYearly: number;
  trialDays?: number;
  trialReminderDays?: number[];
}): { trialDays: number; trialReminderDays: number[] } {
  if (isFreeSubscriptionPlan(plan)) {
    return { trialDays: 0, trialReminderDays: [] };
  }
  const trialDays = Math.max(0, Math.min(365, Math.floor(Number(plan.trialDays ?? 0))));
  return {
    trialDays,
    trialReminderDays: normalizeTrialReminderDays(
      plan.trialReminderDays,
      trialDays,
    ),
  };
}
