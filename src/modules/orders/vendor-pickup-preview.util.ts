import { OrderStatusEnum } from '@schemas/order.schema';

/**
 * Statuts où le vendeur peut prévisualiser / confirmer un retrait par code.
 * Aligné sur `confirmPickupByCode` (hors created / shipped / completed / cancelled).
 */
export function isVendorPickupConfirmableStatus(status: string): boolean {
  const st = String(status ?? '')
    .trim()
    .toLowerCase();
  if (
    st === OrderStatusEnum.CREATED ||
    st === OrderStatusEnum.SHIPPED ||
    st === OrderStatusEnum.COMPLETED ||
    st === OrderStatusEnum.CANCELLED
  ) {
    return false;
  }
  return (
    st === OrderStatusEnum.PAIED ||
    st === 'paid' ||
    st === OrderStatusEnum.AWAITING_CASH ||
    st === OrderStatusEnum.APPROVED
  );
}

/** Référence courte affichée vendeur (# + 6 derniers chars). */
export function vendorPickupOrderRef(orderId: string): string {
  const id = orderId.trim();
  if (id.length < 6) return id ? `#${id.toUpperCase()}` : '—';
  return `#${id.slice(-6).toUpperCase()}`;
}
