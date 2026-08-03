/** Clé metadata Stripe pour le numéro d’affichage plateforme (1, 2, 3…). */
export const PLATFORM_PAYOUT_NUMBER_META_KEY = 'platformPayoutNumber';

export type PayoutNumberSeed = {
  id: string;
  /** Unix seconds (Stripe `created`). */
  created: number;
  number: number | null;
};

/**
 * Lit le numéro d’affichage depuis les metadata Stripe Connect.
 * Ignore valeurs non entières / &lt; 1.
 */
export function parsePlatformPayoutNumber(
  metadata: Record<string, string> | null | undefined,
): number | null {
  const raw = metadata?.[PLATFORM_PAYOUT_NUMBER_META_KEY];
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  // Entier ≥ 1 uniquement — évite NaN / décimales metadata corrompues.
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
  return n;
}

/**
 * Complète les numéros manquants (plus ancien = plus petit numéro libre).
 * Ne renumérote jamais un `number` déjà attribué.
 */
export function planMissingPayoutNumberAssignments(seeds: PayoutNumberSeed[]): {
  assignments: Array<{ id: string; number: number }>;
  nextNumber: number;
} {
  // 1. Chronologie stable (created puis id) pour un #1 = plus ancien.
  const sorted = [...seeds].sort((a, b) => {
    if (a.created !== b.created) return a.created - b.created;
    return a.id.localeCompare(b.id);
  });
  const used = new Set<number>();
  for (const s of sorted) {
    if (s.number != null) used.add(s.number);
  }
  let cursor = 1;
  const assignments: Array<{ id: string; number: number }> = [];
  for (const s of sorted) {
    if (s.number != null) continue;
    // 2. Sauter les numéros déjà pris (ex. payout manuel créé avant backfill).
    while (used.has(cursor)) cursor += 1;
    assignments.push({ id: s.id, number: cursor });
    used.add(cursor);
    cursor += 1;
  }
  const maxUsed = used.size === 0 ? 0 : Math.max(...Array.from(used));
  return { assignments, nextNumber: maxUsed + 1 };
}

/**
 * Libellé UI canonique demandé produit : « Payout #N ».
 * Ne jamais exposer `po_…` (référence technique hors titre).
 */
export function formatPayoutDisplayLabel(
  number: number | null | undefined,
  fallbackId?: string | null,
): string {
  if (typeof number === 'number' && Number.isFinite(number) && number >= 1) {
    return `Payout #${Math.floor(number)}`;
  }
  // Fix: repli po_… retiré — titre générique tant que number absent.
  const id = String(fallbackId ?? '').trim();
  if (!id || id.toLowerCase().startsWith('po_')) return 'Payout';
  return id;
}
