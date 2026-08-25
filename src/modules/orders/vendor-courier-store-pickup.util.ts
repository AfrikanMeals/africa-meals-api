/**
 * Confirmation vendeur — remise commande au livreur au restaurant (audit, non bloquant).
 */

import { parseStoreCollectedAt } from '@modules/delivery-agent/delivery-agent-store-collected.util';

export type VendorStorePickupOrderSnapshot = {
  shouldShip?: boolean;
  status?: string | null;
  isPickup?: boolean;
  storeCollectedAt?: Date | string | null;
  storeCollectedConfirmedAt?: Date | string | null;
  assignedDeliveryUserId?: string | null;
  storeOwnerUserId?: string | null;
  /** Livreur assigné = vendeur boutique (self-delivery) — pas d’alerte restaurant. */
  assigneeIsStoreVendor?: boolean;
};

function parseConfirmedAt(
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

/** Commande livrée par un livreur tiers (pas retrait client seul). */
export function orderIsThirdPartyCourierDelivery(
  order: Pick<VendorStorePickupOrderSnapshot, 'shouldShip' | 'isPickup'>,
): boolean {
  if (order.shouldShip !== true) return false;
  if (order.isPickup === true) return false;
  return true;
}

/**
 * Self-delivery ou même acteur boutique+livreur : auto-confirm sans alerte vendeur.
 */
export function shouldSkipVendorStorePickupAlert(
  order: VendorStorePickupOrderSnapshot,
): boolean {
  if (!orderIsThirdPartyCourierDelivery(order)) return true;
  if (order.assigneeIsStoreVendor === true) return true;
  const assignee = String(order.assignedDeliveryUserId ?? '').trim();
  const owner = String(order.storeOwnerUserId ?? '').trim();
  return !!assignee && !!owner && assignee === owner;
}

/** Vendeur peut confirmer la remise au livreur (endpoint POST). */
export function canVendorConfirmCourierStorePickup(
  order: VendorStorePickupOrderSnapshot,
): boolean {
  if (!orderIsThirdPartyCourierDelivery(order)) return false;
  if (String(order.status ?? '').trim().toLowerCase() !== 'shipped') {
    return false;
  }
  if (parseStoreCollectedAt(order.storeCollectedAt) == null) return false;
  if (parseConfirmedAt(order.storeCollectedConfirmedAt) != null) return false;
  if (shouldSkipVendorStorePickupAlert(order)) return false;
  return true;
}

/** Alerte live vendeur : collect déclarée, confirmation restaurant en attente. */
export function needsVendorStorePickupConfirmAlert(
  order: VendorStorePickupOrderSnapshot,
): boolean {
  return canVendorConfirmCourierStorePickup(order);
}

/** ISO8601 pour WS / réponses API. */
export function storeCollectedConfirmedAtIso(
  raw: Date | string | null | undefined,
): string | null {
  const d = parseConfirmedAt(raw);
  return d ? d.toISOString() : null;
}
