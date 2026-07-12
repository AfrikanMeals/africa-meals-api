import { CartItemTypeEnum } from '@schemas/cart_item.schema';
import type { OrderModel, OrdeLineItem } from '@schemas/order.schema';
import type { GraphOrderCompletedPayload, GraphOrderLineItem } from './graph-sync.types';

function refIdFromOrderField(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (typeof raw === 'object' && raw !== null) {
    const o = raw as { _id?: unknown; id?: unknown };
    const id = o._id ?? o.id;
    if (id != null) return String(id);
  }
  return undefined;
}

export function buildGraphOrderCompletedPayload(
  order: OrderModel,
  opts?: {
    userId?: string;
    storeId?: string;
  },
): GraphOrderCompletedPayload | null {
  const orderId = String(
    (order as { _id?: unknown; id?: unknown })._id ??
      (order as { id?: unknown }).id ??
      '',
  ).trim();
  const userId =
    opts?.userId?.trim() ||
    refIdFromOrderField(order.user) ||
    '';
  const storeId =
    opts?.storeId?.trim() ||
    refIdFromOrderField(order.store) ||
    '';
  if (!orderId || !userId || !storeId) return null;

  const items: GraphOrderLineItem[] = [];
  for (const line of (order.items ?? []) as OrdeLineItem[]) {
    const entityId = String(line.entityId ?? '').trim();
    if (!entityId) continue;
    let itemType: GraphOrderLineItem['itemType'] = 'other';
    if (line.itemType === CartItemTypeEnum.PRODUCT) itemType = 'product';
    else if (line.itemType === CartItemTypeEnum.DRINK) itemType = 'drink';
    else if (line.itemType === CartItemTypeEnum.PRODUCT_EXTRA) {
      itemType = 'product';
    }
    items.push({
      entityId,
      itemType,
      quantity: Math.max(1, Number(line.quantity) || 1),
      price: Number(line.price) || 0,
      ...(line.label ? { label: String(line.label) } : {}),
      ...(line.categoryTitle
        ? { categoryTitle: String(line.categoryTitle) }
        : {}),
    });
  }

  const region = String(
    (order as { storeRegionCode?: string }).storeRegionCode ??
      (order as { taxCountryCode?: string }).taxCountryCode ??
      '',
  )
    .trim()
    .toUpperCase()
    .slice(0, 2);

  return {
    orderId,
    userId,
    storeId,
    ...(region.length === 2 ? { region } : {}),
    ...(order.currency ? { currency: String(order.currency) } : {}),
    totalSpent: Number(order.totalPrice) || 0,
    items,
    completedAt: new Date().toISOString(),
  };
}
