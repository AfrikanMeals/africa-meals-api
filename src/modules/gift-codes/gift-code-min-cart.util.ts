/**
 * Seuil panier minimal pour qu’un gift code soit applicable.
 * 0 / absent = aucun seuil (comportement historique).
 */

/** Normalise minCartAmount (major units) — legacy / NaN → 0. */
export function normalizeGiftMinCartAmount(raw?: number | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Même plafond que les montants FIXED gift.
  return Math.min(999_999, Math.round(n * 100 + Number.EPSILON) / 100);
}

/**
 * True si le sous-total éligible (après coupon boutique) atteint le seuil.
 * min ≤ 0 → toujours OK.
 */
export function isGiftCodeMinCartMet(
  eligibleSubtotal: number,
  minCartAmount?: number | null,
): boolean {
  const min = normalizeGiftMinCartAmount(minCartAmount);
  if (min <= 0) return true;
  const sub = Math.max(0, Number(eligibleSubtotal) || 0);
  return sub + 1e-9 >= min;
}
