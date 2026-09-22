/** Override manuel Ouvert/Fermé (bypass horaires). */
export type StoreTradingOverride = 'open' | 'closed';

export type ResolveStoreTradingOpenInput = {
  status?: string | null;
  acceptsOrders?: boolean | null;
  tradingOverride?: string | null;
  /** Conservé pour compat tests ; ignoré (défaut = ouvert hors closed). */
  hoursClosed?: boolean;
};

/**
 * Normalise le champ API/Mongo (`open` | `closed` | null).
 * Valeurs inconnues → null (= ouvert par défaut).
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
 * Ouverture effective catalogue / checkout.
 * Défaut = ouvert (ACTIVE) ; seul `tradingOverride=closed` ferme.
 * Bypass horaires ; `acceptsOrders` legacy ignoré sauf si on veut rester fermé
 * uniquement via override closed (sync API pose acceptsOrders=false).
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
  // Seul l’override fermé bloque ; open / null = ouvert (défaut).
  if (override === 'closed') return false;
  return true;
}

/**
 * Mongo/aggregation : exclure uniquement les boutiques explicitement fermées.
 * Couvre camelCase + snake_case.
 */
export function storeNotTradingClosedMatch(
  storePrefix = '',
): Record<string, unknown> {
  const camel = storePrefix
    ? `${storePrefix}.tradingOverride`
    : 'tradingOverride';
  const snake = storePrefix
    ? `${storePrefix}.trading_override`
    : 'trading_override';
  return {
    $and: [{ [camel]: { $ne: 'closed' } }, { [snake]: { $ne: 'closed' } }],
  };
}

/** Sync checkout / DB : open → true, closed → false. */
export function acceptsOrdersForTradingOverride(
  override: StoreTradingOverride,
): boolean {
  return override === 'open';
}
