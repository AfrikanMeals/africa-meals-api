import { OrderStatusEnum } from '@schemas/order.schema';

/** Onglets historique mobile : pending | cancelled | approved. */
export type DeliveryHistoryStatusTab =
  | 'pending'
  | 'cancelled'
  | 'approved';

export function resolveDeliveryHistoryStatusFilter(
  statusTab?: string | null,
): OrderStatusEnum[] {
  const key = (statusTab ?? '').trim().toLowerCase();
  switch (key) {
    case 'pending':
      return [OrderStatusEnum.SHIPPED];
    case 'cancelled':
      return [OrderStatusEnum.CANCELLED];
    case 'approved':
      return [OrderStatusEnum.COMPLETED];
    default:
      return [OrderStatusEnum.SHIPPED, OrderStatusEnum.COMPLETED];
  }
}

export function parseDeliveryHistoryPage(raw?: string | number | null): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

export function parseDeliveryHistoryTake(
  raw?: string | number | null,
  fallback = 20,
): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(100, Math.floor(n));
}
