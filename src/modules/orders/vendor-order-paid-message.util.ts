import {
  customizationSummaryLabel,
  normalizeSelectedComplements,
  normalizeSelectedSupplements,
} from '@modules/cart/cart-customization.util';
import type { OrdeLineItem } from '@schemas/order.schema';

export type VendorOrderNotifyMessageArgs = {
  orderId: string;
  items: OrdeLineItem[];
  totalPrice: number;
  currency?: string;
  pickupCode?: string;
  storeName?: string;
};

/** @deprecated alias */
export type VendorOrderPaidMessageArgs = VendorOrderNotifyMessageArgs;

function formatMoney(amount: number, currency?: string): string {
  const cur = (currency ?? '').trim().toUpperCase();
  const n = Math.round(amount * 100) / 100;
  const formatted = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return cur ? `${formatted} ${cur}` : formatted;
}

function orderRef(orderId: string): string {
  const id = orderId.trim();
  return id.length > 6 ? id.slice(-6).toUpperCase() : id.toUpperCase();
}

function formatLineItem(item: OrdeLineItem): string {
  const qty = Math.max(1, Math.round(Number(item.quantity) || 1));
  const label = String(item.label ?? 'Article').trim() || 'Article';
  const extras = customizationSummaryLabel(
    normalizeSelectedComplements(item.selectedComplements),
    normalizeSelectedSupplements(item.selectedSupplements),
  );
  const base = qty > 1 ? `${label} ×${qty}` : label;
  return extras ? `${base} — ${extras}` : base;
}

/** Message boutique — commande créée, en attente de paiement. */
export function buildVendorOrderCreatedInboxMessage(
  args: VendorOrderNotifyMessageArgs,
): string {
  const ref = orderRef(args.orderId);
  const total = formatMoney(args.totalPrice, args.currency);
  const itemCount = args.items.reduce(
    (s, i) => s + Math.max(1, Math.round(Number(i.quantity) || 1)),
    0,
  );
  const lines: string[] = [
    `Nouvelle commande · #${ref} · ${itemCount} article${itemCount > 1 ? 's' : ''} · Total ${total} (en attente de paiement)`,
  ];
  for (const item of args.items) {
    lines.push(`• ${formatLineItem(item)}`);
  }
  return lines.join('\n').slice(0, 4000);
}

/** Message détaillé pour `stores.vendor_messages` (centre de notifications vendeur). */
export function buildVendorOrderPaidInboxMessage(
  args: VendorOrderNotifyMessageArgs,
): string {
  const ref = orderRef(args.orderId);
  const total = formatMoney(args.totalPrice, args.currency);
  const itemCount = args.items.reduce(
    (s, i) => s + Math.max(1, Math.round(Number(i.quantity) || 1)),
    0,
  );
  const lines: string[] = [
    `Commande payée · #${ref} · ${itemCount} article${itemCount > 1 ? 's' : ''} · Total ${total}`,
  ];
  for (const item of args.items) {
    lines.push(`• ${formatLineItem(item)}`);
  }
  const code = args.pickupCode?.trim();
  if (code) {
    lines.push(`Code retrait : ${code.toUpperCase()}`);
  }
  return lines.join('\n').slice(0, 4000);
}

/** Corps court pour la notification push FCM vendeur. */
export function buildVendorOrderPaidPushBody(
  args: VendorOrderNotifyMessageArgs,
): string {
  const store = (args.storeName ?? '').trim() || 'Boutique';
  const ref = orderRef(args.orderId);
  const total = formatMoney(args.totalPrice, args.currency);
  const firstLine = args.items[0] ? formatLineItem(args.items[0]) : '';
  const more = args.items.length > 1 ? ` (+${args.items.length - 1})` : '';
  const detail = firstLine ? ` — ${firstLine}${more}` : '';
  const code = args.pickupCode?.trim();
  const pickup = code ? ` · Code ${code.toUpperCase()}` : '';
  return `${store} : commande #${ref} payée (${total})${detail}${pickup}`.slice(
    0,
    240,
  );
}
