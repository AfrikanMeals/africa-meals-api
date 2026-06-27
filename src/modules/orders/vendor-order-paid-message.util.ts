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
  const row = item as OrdeLineItem & { selectedVariantLabel?: string };
  const extras = customizationSummaryLabel(
    normalizeSelectedComplements(item.selectedComplements),
    normalizeSelectedSupplements(item.selectedSupplements),
    row.selectedVariantLabel,
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

/** Message inbox vendeur — commande retrait avec paiement cash à effectuer au retrait. */
export function buildVendorOrderPayOnPickupInboxMessage(
  args: VendorOrderNotifyMessageArgs,
): string {
  const ref = orderRef(args.orderId);
  const total = formatMoney(args.totalPrice, args.currency);
  const itemCount = args.items.reduce(
    (s, i) => s + Math.max(1, Math.round(Number(i.quantity) || 1)),
    0,
  );
  const lines: string[] = [
    `Commande à payer à la collecte · #${ref} · ${itemCount} article${itemCount > 1 ? 's' : ''} · Total ${total}`,
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

export type VendorOrderNotifyReason =
  | 'new_order'
  | 'order_paid'
  | 'order_accepted'
  | 'order_ready'
  | 'order_shipped'
  | 'order_cancelled'
  | 'order_completed';

export function vendorOrderStatusLabelFr(
  status: string,
  isPickup?: boolean,
  payOnPickup?: boolean,
): string {
  switch (status) {
    case 'created':
      return 'Nouvelle commande (en attente de paiement)';
    case 'awaiting_cash':
      if (payOnPickup) {
        return 'À payer à la collecte';
      }
      return 'En attente de paiement';
    case 'paied':
    case 'paid':
      if (payOnPickup) {
        return 'À payer à la collecte';
      }
      return 'Commande payée';
    case 'approved':
      return isPickup ? 'Prête pour retrait' : 'Prête pour livraison';
    case 'shipped':
      return 'En livraison';
    case 'cancelled':
      return 'Commande annulée';
    case 'completed':
      return 'Commande terminée';
    default:
      return status;
  }
}

/** Message inbox vendeur pour un changement de statut (hors création / paiement détaillés). */
export function buildVendorOrderStatusInboxMessage(
  args: VendorOrderNotifyMessageArgs & {
    statusLabel: string;
    note?: string;
  },
): string {
  const ref = orderRef(args.orderId);
  const total = formatMoney(args.totalPrice, args.currency);
  const itemCount = args.items.reduce(
    (s, i) => s + Math.max(1, Math.round(Number(i.quantity) || 1)),
    0,
  );
  const lines: string[] = [
    `${args.statusLabel} · #${ref} · ${itemCount} article${itemCount > 1 ? 's' : ''} · Total ${total}`,
  ];
  for (const item of args.items) {
    lines.push(`• ${formatLineItem(item)}`);
  }
  const note = args.note?.trim();
  if (note) {
    lines.push(note);
  }
  const code = args.pickupCode?.trim();
  if (code) {
    lines.push(`Code retrait : ${code.toUpperCase()}`);
  }
  return lines.join('\n').slice(0, 4000);
}

export function buildVendorOrderStatusPush(args: {
  reason: VendorOrderNotifyReason;
  storeName?: string;
  orderId: string;
  totalPrice?: number;
  currency?: string;
  note?: string;
  isPickup?: boolean;
  pushBodyOverride?: string;
}): { title: string; body: string; reason: string } {
  if (args.pushBodyOverride?.trim()) {
    const titles: Record<VendorOrderNotifyReason, string> = {
      new_order: 'Nouvelle commande',
      order_paid: 'Commande payée',
      order_accepted: 'Commande en préparation',
      order_ready: 'Commande prête',
      order_shipped: 'Commande en livraison',
      order_cancelled: 'Commande annulée',
      order_completed: 'Commande terminée',
    };
    return {
      title: titles[args.reason],
      body: args.pushBodyOverride.trim().slice(0, 240),
      reason: args.reason,
    };
  }

  const store = (args.storeName ?? '').trim() || 'Boutique';
  const ref = orderRef(args.orderId);
  const total =
    args.totalPrice != null
      ? formatMoney(args.totalPrice, args.currency)
      : '';
  const totalPart = total ? ` (${total})` : '';

  switch (args.reason) {
    case 'new_order':
      return {
        title: 'Nouvelle commande',
        body: `${store} : nouvelle commande (en attente de paiement).`,
        reason: 'new_order',
      };
    case 'order_paid':
      return {
        title: 'Commande payée',
        body: `${store} : commande #${ref} payée${totalPart}.`,
        reason: 'order_paid',
      };
    case 'order_accepted':
      return {
        title: 'Commande en préparation',
        body: `${store} : commande #${ref} prise en charge.`,
        reason: 'order_accepted',
      };
    case 'order_ready': {
      const ready = args.isPickup ? 'prête pour retrait' : 'prête pour livraison';
      return {
        title: 'Commande prête',
        body: `${store} : commande #${ref} ${ready}.`,
        reason: 'order_ready',
      };
    }
    case 'order_shipped':
      return {
        title: 'Commande en livraison',
        body: args.note?.trim()
          ? `${store} : commande #${ref} — ${args.note.trim()}`
          : `${store} : commande #${ref} en livraison.`,
        reason: 'order_shipped',
      };
    case 'order_cancelled':
      return {
        title: 'Commande annulée',
        body: args.note?.trim()
          ? `${store} : commande #${ref} annulée — ${args.note.trim()}`
          : `${store} : commande #${ref} annulée.`,
        reason: 'order_cancelled',
      };
    case 'order_completed':
      return {
        title: 'Commande terminée',
        body: `${store} : commande #${ref} terminée.`,
        reason: 'order_completed',
      };
  }
}

/** Corps court pour la notification push FCM vendeur — commande créée. */
export function buildVendorOrderCreatedPushBody(
  args: VendorOrderNotifyMessageArgs,
): string {
  const store = (args.storeName ?? '').trim() || 'Boutique';
  const ref = orderRef(args.orderId);
  const total = formatMoney(args.totalPrice, args.currency);
  const itemCount = args.items.reduce(
    (s, i) => s + Math.max(1, Math.round(Number(i.quantity) || 1)),
    0,
  );
  return `${store} · #${ref} · ${itemCount} article${itemCount > 1 ? 's' : ''} · ${total} (en attente de paiement)`;
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

/** Corps court push vendeur — commande retrait, paiement cash attendu au retrait. */
export function buildVendorOrderPayOnPickupPushBody(
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
  return `${store} : commande #${ref} à payer au retrait (${total})${detail}${pickup}`.slice(
    0,
    240,
  );
}
