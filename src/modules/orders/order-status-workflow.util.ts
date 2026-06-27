import { OrderStatusEnum } from '@schemas/order.schema';

/** Statuts où le vendeur peut accepter / marquer prête (payée en ligne ou cash au retrait). */
export function isOrderStatusPaidForVendorWorkflow(
  status: OrderStatusEnum | string,
): boolean {
  const s = String(status ?? '').toLowerCase();
  return (
    s === OrderStatusEnum.PAIED || s === OrderStatusEnum.AWAITING_CASH
  );
}

/** Annulation client sans remboursement Stripe (pay on pickup). */
export function isOrderStatusCancellablePayOnPickup(
  status: OrderStatusEnum | string,
): boolean {
  return isOrderStatusPaidForVendorWorkflow(status);
}
