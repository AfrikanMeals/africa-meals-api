/**
 * Règles « pris au restaurant » (champ horodaté, pas de nouveau OrderStatus).
 * Isolées pour tests anti-régression (idempotence / abandon bloqué).
 */

export type StoreCollectedOrderSnapshot = {
  shouldShip?: boolean;
  status?: string | null;
  assignedDeliveryUserId?: string | null;
  storeCollectedAt?: Date | string | null;
};

/** Normalise un horodatage Mongo / ISO en Date, sinon null. */
export function parseStoreCollectedAt(
  raw: Date | string | null | undefined,
): Date | null {
  if (raw == null) return null;
  if (raw instanceof Date) {
    return Number.isFinite(raw.getTime()) ? raw : null;
  }
  const s = String(raw).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Le livreur peut confirmer la collecte boutique si :
 * livraison, shipped, assignee, et champ encore vide.
 */
export function canConfirmStoreCollected(
  order: StoreCollectedOrderSnapshot,
  agentUserId: string,
): boolean {
  if (order.shouldShip !== true) return false;
  if (String(order.status ?? '').trim().toLowerCase() !== 'shipped') {
    return false;
  }
  const assignee = String(order.assignedDeliveryUserId ?? '').trim();
  const agent = String(agentUserId ?? '').trim();
  if (!assignee || !agent || assignee !== agent) return false;
  return parseStoreCollectedAt(order.storeCollectedAt) == null;
}

/**
 * Après collecte boutique, abandon livreur interdit
 * (commande déjà en route client).
 */
export function isOrderAbandonableAfterStoreCollect(
  storeCollectedAt: Date | string | null | undefined,
): boolean {
  return parseStoreCollectedAt(storeCollectedAt) == null;
}

/** Payload WS / mapping agent — ISO ou null. */
export function storeCollectedAtIso(
  raw: Date | string | null | undefined,
): string | null {
  const d = parseStoreCollectedAt(raw);
  return d ? d.toISOString() : null;
}
