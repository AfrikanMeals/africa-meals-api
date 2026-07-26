import {
  isFreePlanName,
  isFreeSubscriptionPlan,
} from '@modules/subscriptions/subscription-plan.util';

export { isFreePlanName, isFreeSubscriptionPlan };

type FreePlanCandidate = {
  name: string;
  priceMonthly: number;
  priceYearly: number;
  active?: boolean;
};

/**
 * Choisit le plan FREE Partner par défaut parmi un catalogue.
 * Priorité : nom FREE (ou préfixe) + prix 0 → sinon premier plan prix 0/0 actif.
 */
export function pickDefaultPartnerFreePlan<T extends FreePlanCandidate>(
  plans: T[],
): T | null {
  const active = plans.filter((p) => p.active !== false);
  const byName = active.find(
    (p) => isFreePlanName(p.name) && isFreeSubscriptionPlan(p),
  );
  if (byName) return byName;
  return active.find((p) => isFreeSubscriptionPlan(p)) ?? null;
}
