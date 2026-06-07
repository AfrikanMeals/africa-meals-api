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

/**
 * Statuts Schema.org pour le balisage e-mail « Order » (carte achat Gmail).
 * @see https://schema.org/OrderStatus
 */
export const OrderSchemaStatus = {
  processing: 'https://schema.org/OrderProcessing',
  inTransit: 'https://schema.org/OrderInTransit',
  delivered: 'https://schema.org/OrderDelivered',
  problem: 'https://schema.org/OrderProblem',
  cancelled: 'https://schema.org/OrderCancelled',
} as const;

export type OrderEmailJsonLdOptions = {
  /** Numéro de commande affiché (ex. 8 derniers caractères). */
  ref: string;
  /** URL Schema.org (cf. OrderSchemaStatus). Défaut : processing. */
  orderStatus?: string;
  /** URL publique de la commande (https). Active le bouton « Voir la commande ». */
  orderUrl?: string;
  /** Libellé du bouton d'action. */
  actionName?: string;
};

/**
 * Résout l'URL publique d'une commande pour les e-mails.
 * - `template` contenant `{orderId}` → substitution directe.
 * - sinon, base URL → `<base>/orders/<id>`.
 * Retourne `undefined` si aucun template/base n'est fourni (pas de lien cassé).
 */
export function resolveOrderPublicUrl(
  template: string | undefined | null,
  orderId: string,
): string | undefined {
  const tmpl = (template ?? '').trim();
  const id = (orderId ?? '').trim();
  if (!tmpl || !id) return undefined;
  if (tmpl.includes('{orderId}')) {
    return tmpl.replace('{orderId}', encodeURIComponent(id));
  }
  return `${tmpl.replace(/\/+$/, '')}/orders/${encodeURIComponent(id)}`;
}

/**
 * Construit le balisage Schema.org `Order` (JSON-LD) à partir d'un reçu.
 * Réutilisable par tous les e-mails de commande (payée, expédiée, etc.).
 */
export function buildOrderEmailJsonLd(
  snapshot: OrderInvoiceSnapshot,
  opts: OrderEmailJsonLdOptions,
): Record<string, unknown> {
  const currency = (snapshot.currency || 'CAD').trim().toUpperCase() || 'CAD';
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];

  const acceptedOffer = items
    .filter((it): it is OrdeLineItem => Boolean(it) && typeof it === 'object')
    .map((it) => {
      const row = it as { label?: unknown; price?: unknown; quantity?: unknown };
      const name = String(row.label ?? '').trim() || 'Article';
      const qty = Number(row.quantity);
      const unit = Number(row.price);
      const offer: Record<string, unknown> = {
        '@type': 'Offer',
        itemOffered: { '@type': 'Product', name },
        eligibleQuantity: {
          '@type': 'QuantitativeValue',
          value: qty > 0 ? Math.floor(qty) : 1,
        },
      };
      if (Number.isFinite(unit)) {
        offer.price = unit.toFixed(2);
        offer.priceCurrency = currency;
      }
      return offer;
    });

  const orderUrl = opts.orderUrl?.trim();

  return {
    '@context': 'https://schema.org',
    '@type': 'Order',
    merchant: { '@type': 'Organization', name: snapshot.storeName },
    orderNumber: opts.ref,
    priceCurrency: currency,
    price: (Number(snapshot.totalPrice) || 0).toFixed(2),
    orderStatus: opts.orderStatus ?? OrderSchemaStatus.processing,
    customer: { '@type': 'Person', name: snapshot.clientName },
    acceptedOffer,
    ...(orderUrl
      ? {
          url: orderUrl,
          potentialAction: {
            '@type': 'ViewAction',
            name: opts.actionName ?? 'Voir la commande',
            target: orderUrl,
          },
        }
      : {}),
  };
}

export function lineCustomizationText(item: OrdeLineItem): string {
  const row = item as OrdeLineItem & {
    selectedComplements?: unknown;
    selectedSupplements?: unknown;
    selectedVariantLabel?: string;
  };
  return customizationSummaryLabel(
    normalizeSelectedComplements(row.selectedComplements),
    normalizeSelectedSupplements(row.selectedSupplements),
    row.selectedVariantLabel,
  );
}
