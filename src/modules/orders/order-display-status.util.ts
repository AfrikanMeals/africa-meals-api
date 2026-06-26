import { OrderStatusEnum } from '@schemas/order.schema';

/** Libellé statut commande client — paiement cash à la collecte non encore encaissé. */
export const PAY_ON_PICKUP_UNSETTLED_STATUS_LABEL = 'À payer';

/** Colonne paiement admin / finances — encaissement cash en attente. */
export const PAY_ON_PICKUP_UNSETTLED_PAYMENT_LABEL = 'Non réglée';

/** Paiement cash collecté (commande terminée). */
export const PAY_ON_PICKUP_SETTLED_PAYMENT_LABEL = 'Réglée';

export function readOrderStripeParentPaymentId(
  order: Record<string, unknown>,
): string {
  return String(
    order['stripeParentPaymentId'] ?? order['stripe_parent_payment_id'] ?? '',
  ).trim();
}

/**
 * Commande « paiement à la collecte » (cash) — flag explicite ou absence de paiement Stripe
 * alors que le workflow commande a démarré (statut au-delà de `created`).
 */
export function isPayOnPickupOrder(order: Record<string, unknown>): boolean {
  if (order['payOnPickup'] === true || order['pay_on_pickup'] === true) {
    return true;
  }
  if (readOrderStripeParentPaymentId(order).length > 0) {
    return false;
  }
  const st = String(order['status'] ?? '').toLowerCase();
  return (
    st === OrderStatusEnum.PAIED ||
    st === OrderStatusEnum.APPROVED ||
    st === OrderStatusEnum.SHIPPED ||
    st === OrderStatusEnum.COMPLETED
  );
}

export function readOrderPayOnPickup(order: Record<string, unknown>): boolean {
  return isPayOnPickupOrder(order);
}

export function readVendorAcceptedAt(
  order: Record<string, unknown>,
): string | null {
  const raw = order['vendorAcceptedAt'] ?? order['vendor_accepted_at'];
  if (raw instanceof Date) {
    return raw.toISOString();
  }
  const s = String(raw ?? '').trim();
  return s.length > 0 ? s : null;
}

export function isVendorAcceptedPreparingOrder(
  order: Record<string, unknown>,
): boolean {
  const st = String(order['status'] ?? '').toLowerCase();
  return st === OrderStatusEnum.PAIED && readVendorAcceptedAt(order) != null;
}

/** Paiement à la collecte encore dû (hors annulation). */
export function isPayOnPickupUnsettled(order: Record<string, unknown>): boolean {
  if (!readOrderPayOnPickup(order)) return false;
  const st = String(order['status'] ?? '').toLowerCase();
  return (
    st !== OrderStatusEnum.COMPLETED && st !== OrderStatusEnum.CANCELLED
  );
}

export function publicOrderStatusLabelFr(
  order: Record<string, unknown>,
): string {
  if (isPayOnPickupUnsettled(order)) {
    return PAY_ON_PICKUP_UNSETTLED_STATUS_LABEL;
  }
  const status = String(order['status'] ?? '').toLowerCase();
  switch (status) {
    case OrderStatusEnum.PAIED:
      if (isVendorAcceptedPreparingOrder(order)) {
        return 'En préparation';
      }
      return 'Payée';
    case OrderStatusEnum.APPROVED:
      return 'Confirmée';
    case OrderStatusEnum.SHIPPED:
      return 'En livraison';
    case OrderStatusEnum.COMPLETED:
      return 'Terminée';
    case OrderStatusEnum.CANCELLED:
      return 'Annulée';
    case OrderStatusEnum.CREATED:
      return 'En attente de paiement';
    default:
      return 'Commande';
  }
}

export function orderPaymentStatusLabelFr(
  order: Record<string, unknown>,
): string {
  if (readOrderPayOnPickup(order)) {
    return isPayOnPickupUnsettled(order)
      ? PAY_ON_PICKUP_UNSETTLED_PAYMENT_LABEL
      : PAY_ON_PICKUP_SETTLED_PAYMENT_LABEL;
  }
  const status = String(order['status'] ?? '').toLowerCase();
  switch (status) {
    case OrderStatusEnum.CREATED:
      return 'En attente de paiement';
    case OrderStatusEnum.CANCELLED:
      return '—';
    default:
      return 'Payée';
  }
}

export function enrichOrderDisplayStatus(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const payOnPickup = readOrderPayOnPickup(row);
  return {
    ...row,
    payOnPickup,
    statusLabel: publicOrderStatusLabelFr(row),
    paymentStatusLabel: orderPaymentStatusLabelFr(row),
  };
}

export function enrichOrdersDisplayStatus(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows.map((row) => enrichOrderDisplayStatus(row));
}
