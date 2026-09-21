/** Override manuel Ouvert/Fermé (bypass horaires). */
export type StoreTradingOverride = 'open' | 'closed';

export type ResolveStoreTradingOpenInput = {
  status?: string | null;
  acceptsOrders?: boolean | null;
  tradingOverride?: string | null;
  /** true si les horaires indiquent fermé (ignoré si override posé). */
  hoursClosed?: boolean;
};

/**
 * Normalise le champ API/Mongo (`open` | `closed` | null).
 * Valeurs inconnues → null (suivre horaires + acceptsOrders).
 */
export function normalizeTradingOverride(
  value: unknown,
): StoreTradingOverride | null {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'open') return 'open';
  if (raw === 'closed') return 'closed';
  return null;
}

/**
 * Ouverture effective pour catalogue / cartes client.
 * Override force l’état ; sinon plateforme (ACTIVE + acceptsOrders) puis horaires.
 */
export function resolveStoreTradingOpen(
  input: ResolveStoreTradingOpenInput,
): boolean {
  const status = String(input.status ?? '')
    .trim()
    .toUpperCase();
  // Boutique non ACTIVE : jamais « ouverte » côté client.
  if (status && status !== 'ACTIVE') {
    return false;
  }

  const override = normalizeTradingOverride(input.tradingOverride);
  if (override === 'open') return true;
  if (override === 'closed') return false;

  // Legacy : pas d’override → acceptsOrders + horaires.
  if (input.acceptsOrders === false) return false;
  if (input.hoursClosed === true) return false;
  return true;
}

/** Sync checkout : open → true, closed → false. */
export function acceptsOrdersForTradingOverride(
  override: StoreTradingOverride,
): boolean {
  return override === 'open';
}
