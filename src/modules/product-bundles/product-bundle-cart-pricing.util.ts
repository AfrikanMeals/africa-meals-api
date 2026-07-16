/**
 * Répartit le prix combo (après remise bundle) sur les lignes panier d’un groupe.
 * Les extras perso (compléments / suppléments) restent hors remise et se rajoutent.
 */

import { computeBundlePricing } from './product-bundle-pricing.util';

const roundMoney = (n: number) => Math.round(n * 100) / 100;

export type BundleCartLinePriceInput = {
  lineId: string;
  /** Prix client catalogue de la composante (hors extras perso). */
  baseCustomerPrice: number;
  /** Extras compléments/suppléments déjà en prix client. */
  extrasCustomerPrice: number;
};

export type BundleCartLinePriceResult = {
  lineId: string;
  /** Prix unitaire final à persister sur la ligne panier. */
  unitPrice: number;
  /** Part du prix combo allouée (hors extras). */
  allocatedBase: number;
};

/**
 * Calcule `computeBundlePricing` sur les bases, répartit `bundlePrice`
 * proportionnellement (méthode du plus grand reste → somme exacte),
 * puis ajoute les extras ligne par ligne.
 */
export function allocateBundleCartLinePrices(
  lines: BundleCartLinePriceInput[],
  discountType: 'percent' | 'fixed',
  discountValue: number,
): BundleCartLinePriceResult[] {
  if (!lines.length) return [];

  const bases = lines.map((l) => Math.max(0, Number(l.baseCustomerPrice) || 0));
  const pricing = computeBundlePricing({
    items: bases.map((customerPrice) => ({ customerPrice })),
    discountType,
    discountValue,
  });

  const allocatedBases = distributeProportionally(bases, pricing.bundlePrice);

  return lines.map((line, i) => {
    const allocatedBase = allocatedBases[i] ?? 0;
    const extras = Math.max(0, Number(line.extrasCustomerPrice) || 0);
    return {
      lineId: line.lineId,
      allocatedBase,
      unitPrice: roundMoney(allocatedBase + extras),
    };
  });
}

/**
 * Répartition proportionnelle en cents avec plus grand reste
 * pour que la somme des parts = `total` (évite l’écart d’arrondi).
 */
export function distributeProportionally(
  weights: number[],
  total: number,
): number[] {
  const n = weights.length;
  if (n === 0) return [];

  const safeTotal = roundMoney(Math.max(0, Number(total) || 0));
  const weightSum = weights.reduce((s, w) => s + Math.max(0, w), 0);

  if (safeTotal <= 0) {
    return weights.map(() => 0);
  }
  if (weightSum <= 0) {
    // Bases nulles : partage égal du prix combo.
    const even = Math.floor((safeTotal * 100) / n) / 100;
    const out = weights.map(() => even);
    let rem = roundMoney(safeTotal - even * n);
    for (let i = 0; i < n && rem > 0.0001; i++) {
      out[i] = roundMoney(out[i] + 0.01);
      rem = roundMoney(rem - 0.01);
    }
    return out;
  }

  const raw = weights.map((w) => (Math.max(0, w) / weightSum) * safeTotal);
  const floors = raw.map((r) => Math.floor(r * 100) / 100);
  let remainderCents = Math.round(
    (safeTotal - floors.reduce((s, x) => s + x, 0)) * 100,
  );

  // Indices triés par partie fractionnaire décroissante.
  const order = raw
    .map((r, i) => ({ i, frac: r * 100 - Math.floor(r * 100) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const out = [...floors];
  for (const { i } of order) {
    if (remainderCents <= 0) break;
    out[i] = roundMoney(out[i] + 0.01);
    remainderCents -= 1;
  }
  return out;
}
