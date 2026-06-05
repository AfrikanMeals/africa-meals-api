import {
  customizationSummaryLabel,
  normalizeSelectedComplements,
  normalizeSelectedSupplements,
} from '@modules/cart/cart-customization.util';
import type { OrdeLineItem } from '@schemas/order.schema';

export type OrderTaxLineInvoice = {
  name: string;
  description?: string;
  amount: number;
};

export type OrderInvoiceSnapshot = {
  orderId: string;
  createdAt?: Date | string;
  status: string;
  totalPrice: number;
  subtotalBeforeTax?: number;
  taxTotal?: number;
  taxLines?: OrderTaxLineInvoice[];
  shippingPrice: number;
  shouldShip?: boolean;
  currency?: string;
  couponCode?: string;
  pickupCode?: string;
  storeName: string;
  storeAddressLine?: string;
  clientName: string;
  clientEmail: string;
  deliveryLine: string;
  items: OrdeLineItem[];
};

export function formatInvoiceMoney(
  value: number,
  currency?: string,
): string {
  const code = (currency ?? 'CAD').trim().toUpperCase() || 'CAD';
  try {
    return new Intl.NumberFormat('fr-CA', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${Number(value).toLocaleString('fr-CA')} ${code}`;
  }
}

export function formatInvoiceDate(iso?: Date | string): string {
  if (!iso) return '—';
  try {
    const d = iso instanceof Date ? iso : new Date(iso);
    return new Intl.DateTimeFormat('fr-CA', {
      dateStyle: 'long',
      timeStyle: 'short',
    }).format(d);
  } catch {
    return String(iso);
  }
}

export function orderInvoiceRef(orderId: string): string {
  const id = orderId.trim();
  return id.length > 8 ? id.slice(-8).toUpperCase() : id.toUpperCase();
}

export function inferInvoicePaymentMethodLabel(status: string): string {
  switch (String(status ?? '').toLowerCase()) {
    case 'created':
      return 'En attente de paiement';
    case 'cancelled':
      return '—';
    case 'paied':
    case 'approved':
    case 'shipped':
    case 'completed':
      return 'Paiement en ligne';
    default:
      return '—';
  }
}

export function formatAddressParts(
  snap?: {
    address?: string;
    city?: string;
    zipCode?: string;
    zip_code?: string;
    country?: string;
    countryCode?: string;
    country_code?: string;
  } | null,
): string {
  if (!snap) return '—';
  const cityLine = [snap.city, snap.zipCode ?? snap.zip_code]
    .filter(Boolean)
    .join(' ');
  const cc = snap.countryCode ?? snap.country_code;
  const tail =
    cc === 'CA' || snap.country === 'Canada'
      ? 'Canada'
      : [snap.country, cc].filter(Boolean).join(' ');
  const parts = [snap.address, cityLine, tail].filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
}

export function formatOrderDeliveryLine(args: {
  shouldShip?: boolean;
  deliveryAddressSnapshot?: Record<string, unknown>;
  userAddresses?: Array<Record<string, unknown>>;
}): string {
  if (!args.shouldShip) {
    return 'Retrait sur place';
  }
  const snap = args.deliveryAddressSnapshot;
  if (snap) {
    const line = formatAddressParts(
      snap as {
        address?: string;
        city?: string;
        zipCode?: string;
        zip_code?: string;
        country?: string;
        countryCode?: string;
        country_code?: string;
      },
    );
    if (line !== '—') return line;
  }
  const list = args.userAddresses ?? [];
  if (!list.length) return '—';
  const a =
    list.find((x) => x['isDefault'] === true) ?? list[0];
  if (!a || typeof a !== 'object') return '—';
  return formatAddressParts(
    a as {
      address?: string;
      city?: string;
      zipCode?: string;
      country?: string;
      countryCode?: string;
    },
  );
}

export function lineCustomizationText(item: OrdeLineItem): string {
  const row = item as OrdeLineItem & {
    selectedComplements?: unknown;
    selectedSupplements?: unknown;
  };
  return customizationSummaryLabel(
    normalizeSelectedComplements(row.selectedComplements),
    normalizeSelectedSupplements(row.selectedSupplements),
  );
}
