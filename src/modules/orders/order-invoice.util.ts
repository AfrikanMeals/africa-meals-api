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
  storeId?: string;
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
  deliveryAddressSnapshot?: Record<string, unknown>;
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

/** Objet e-mail compatible classification Gmail Purchases (mot-clé Receipt / Invoice). */
export function orderReceiptEmailSubject(
  storeName: string,
  ref: string,
): string {
  const store = storeName.trim() || 'Restaurant';
  return `${store} Receipt & Invoice #${ref}`;
}

function formatOrderDateIso(iso?: Date | string): string | undefined {
  if (!iso) return undefined;
  try {
    const d = iso instanceof Date ? iso : new Date(iso);
    if (Number.isNaN(d.getTime())) return undefined;
    return d.toISOString();
  } catch {
    return undefined;
  }
}

function buildBillingPostalAddress(
  snapshot: OrderInvoiceSnapshot,
): Record<string, unknown> | undefined {
  const snap = snapshot.deliveryAddressSnapshot;
  if (!snap || typeof snap !== 'object') return undefined;
  const streetAddress = String(snap.address ?? '').trim();
  if (!streetAddress) return undefined;

  const locality = String(snap.city ?? '').trim();
  const region = String(snap.zipCode ?? snap.zip_code ?? '').trim();
  const cc = snap.countryCode ?? snap.country_code ?? snap.country;
  let addressCountry = '';
  if (cc === 'CA' || snap.country === 'Canada') {
    addressCountry = 'Canada';
  } else if (typeof cc === 'string' && cc.trim()) {
    addressCountry = cc.trim();
  } else if (typeof snap.country === 'string' && snap.country.trim()) {
    addressCountry = snap.country.trim();
  }

  return {
    '@type': 'PostalAddress',
    name: snapshot.clientName.trim() || snapshot.clientEmail,
    streetAddress,
    ...(locality ? { addressLocality: locality } : {}),
    ...(region ? { addressRegion: region } : {}),
    ...(addressCountry ? { addressCountry } : {}),
  };
}

type LineItemRow = OrdeLineItem & {
  label?: string;
  price?: number;
  quantity?: number;
  pictureUrl?: string;
  picture_url?: string;
  entityId?: string;
  entity_id?: string;
};

/** URL publique d'un produit (boutique + article) pour le balisage Gmail. */
export function resolveProductPublicUrl(
  storeId: string | undefined,
  entityId: string | undefined,
  publicWebUrl?: string | null,
): string | undefined {
  const productId = entityId?.trim();
  const base = publicWebUrl?.trim();
  if (!productId || !base) return undefined;
  const root = base.replace(/\/+$/, '');
  if (storeId?.trim()) {
    return `${root}/stores/${encodeURIComponent(storeId.trim())}/products/${encodeURIComponent(productId)}`;
  }
  return `${root}/products/${encodeURIComponent(productId)}`;
}

function estimateOrderDiscount(
  snapshot: OrderInvoiceSnapshot,
): { amount: string; currency: string } | null {
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const linesSubtotal = items.reduce((acc, it) => {
    const row = it as LineItemRow;
    const qty = Number(row.quantity) || 0;
    const price = Number(row.price) || 0;
    return acc + qty * price;
  }, 0);
  const shipping = Number(snapshot.shippingPrice) || 0;
  const tax = Number(snapshot.taxTotal) || 0;
  const total = Number(snapshot.totalPrice) || 0;
  const beforeDiscount = linesSubtotal + shipping + tax;
  const discount = beforeDiscount - total;
  const currency = (snapshot.currency || 'CAD').trim().toUpperCase() || 'CAD';
  if (discount > 0.009) {
    return { amount: discount.toFixed(2), currency };
  }
  return null;
}

function buildGmailAcceptedOffers(
  snapshot: OrderInvoiceSnapshot,
  currency: string,
  publicWebUrl?: string,
): Record<string, unknown>[] {
  const storeName = snapshot.storeName.trim() || 'Restaurant';
  const storeId = snapshot.storeId;
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const total = Number(snapshot.totalPrice) || 0;

  const toOffer = (
    name: string,
    unitPrice: number,
    qty: number,
    extras?: { sku?: string; image?: string; url?: string },
  ): Record<string, unknown> => {
    const itemOffered: Record<string, unknown> = {
      '@type': 'Product',
      name: name.trim() || 'Order item',
    };
    if (extras?.sku) itemOffered.sku = extras.sku;
    if (extras?.url) itemOffered.url = extras.url;
    if (extras?.image) itemOffered.image = extras.image;

    return {
      '@type': 'Offer',
      itemOffered,
      price: (Number.isFinite(unitPrice) ? unitPrice : total).toFixed(2),
      priceCurrency: currency,
      eligibleQuantity: {
        '@type': 'QuantitativeValue',
        value: String(qty > 0 ? qty : 1),
      },
      seller: { '@type': 'Organization', name: storeName },
    };
  };

  if (!items.length) {
    return [toOffer(`Order from ${storeName}`, total, 1)];
  }

  return items
    .filter((it): it is OrdeLineItem => Boolean(it) && typeof it === 'object')
    .map((it) => {
      const row = it as LineItemRow;
      const name = String(row.label ?? '').trim() || 'Article';
      const qty = Number(row.quantity);
      const unit = Number(row.price);
      const sku = String(row.entityId ?? row.entity_id ?? '').trim() || undefined;
      const image = String(row.pictureUrl ?? row.picture_url ?? '').trim() || undefined;
      const url = resolveProductPublicUrl(storeId, sku, publicWebUrl);
      return toOffer(
        name,
        Number.isFinite(unit) ? unit : 0,
        qty > 0 ? Math.floor(qty) : 1,
        { sku, image, url },
      );
    });
}

/**
 * Résout l'URL publique d'une commande pour les e-mails (JSON-LD + bouton).
 * Priorité : EMAIL_ORDER_URL_TEMPLATE → base site → undefined.
 */
export function resolveOrderEmailPublicUrl(
  orderId: string,
  urls?: {
    orderUrlTemplate?: string | null;
    publicWebUrl?: string | null;
    clientAppUrl?: string | null;
    emailWebsiteUrl?: string | null;
  },
): string | undefined {
  const id = orderId.trim();
  if (!id) return undefined;

  const template = urls?.orderUrlTemplate?.trim();
  if (template) {
    return resolveOrderPublicUrl(template, id);
  }

  for (const raw of [
    urls?.publicWebUrl,
    urls?.clientAppUrl,
    urls?.emailWebsiteUrl,
  ]) {
    const base = raw?.trim();
    if (base) {
      return resolveOrderPublicUrl(base, id);
    }
  }

  return undefined;
}

export function inferInvoicePaymentMethodLabel(status: string): string {
  switch (String(status ?? '').toLowerCase()) {
    case 'created':
      return 'En attente de paiement';
    case 'cancelled':
      return '—';
    case 'paied':
    case 'paid':
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
 * Google utilise des URIs `http://schema.org/...` dans ses exemples officiels.
 * @see https://developers.google.com/workspace/gmail/markup/reference/order
 */
export const OrderSchemaStatus = {
  processing: 'http://schema.org/OrderProcessing',
  inTransit: 'http://schema.org/OrderInTransit',
  delivered: 'http://schema.org/OrderDelivered',
  problem: 'http://schema.org/OrderProblem',
  cancelled: 'http://schema.org/OrderCancelled',
} as const;

export type OrderEmailJsonLdOptions = {
  /** Numéro de commande affiché (ex. 8 derniers caractères). */
  ref: string;
  /** URL Schema.org (cf. OrderSchemaStatus). Défaut : processing. */
  orderStatus?: string;
  /** URL publique de la commande (https). Active le bouton « Voir la commande ». */
  orderUrl?: string;
  /** Base site public pour les URLs produit dans acceptedOffer. */
  publicWebUrl?: string;
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
function normalizeAcceptedOfferForGmail(
  offers: Record<string, unknown>[],
): Record<string, unknown> | Record<string, unknown>[] {
  if (offers.length === 1) return offers[0]!;
  return offers;
}

export function buildOrderEmailJsonLd(
  snapshot: OrderInvoiceSnapshot,
  opts: OrderEmailJsonLdOptions,
): Record<string, unknown> {
  const currency = (snapshot.currency || 'CAD').trim().toUpperCase() || 'CAD';
  const orderUrl = opts.orderUrl?.trim();
  const orderDate = formatOrderDateIso(snapshot.createdAt);
  const offers = buildGmailAcceptedOffers(
    snapshot,
    currency,
    opts.publicWebUrl,
  );
  const acceptedOffer = normalizeAcceptedOfferForGmail(offers);
  const billingAddress = buildBillingPostalAddress(snapshot);
  const totalPrice = (Number(snapshot.totalPrice) || 0).toFixed(2);
  const discount = estimateOrderDiscount(snapshot);

  const payload: Record<string, unknown> = {
    '@context': 'http://schema.org',
    '@type': 'Order',
    merchant: { '@type': 'Organization', name: snapshot.storeName },
    orderNumber: opts.ref,
    priceCurrency: currency,
    price: totalPrice,
    acceptedOffer,
    orderStatus: opts.orderStatus ?? OrderSchemaStatus.processing,
    paymentMethod: {
      '@type': 'PaymentMethod',
      name: 'http://schema.org/CreditCard',
    },
    isGift: 'false',
    customer: { '@type': 'Person', name: snapshot.clientName },
  };

  if (orderDate) {
    payload.orderDate = orderDate;
    payload.priceSpecification = {
      '@type': 'PriceSpecification',
      validFrom: orderDate,
    };
  }

  if (discount) {
    payload.discount = discount.amount;
    payload.discountCurrency = discount.currency;
  }

  if (billingAddress) {
    payload.billingAddress = billingAddress;
  }

  if (orderUrl) {
    payload.url = orderUrl;
    payload.potentialAction = {
      '@type': 'ViewAction',
      url: orderUrl,
    };
  }

  return payload;
}

/**
 * Schéma `Invoice` lié à la commande (reçu payé).
 * @see https://developers.google.com/workspace/gmail/markup/reference/invoice
 */
export function buildInvoiceEmailJsonLd(
  snapshot: OrderInvoiceSnapshot,
  opts: OrderEmailJsonLdOptions,
  orderJsonLd: Record<string, unknown>,
): Record<string, unknown> {
  const currency = (snapshot.currency || 'CAD').trim().toUpperCase() || 'CAD';
  const total = (Number(snapshot.totalPrice) || 0).toFixed(2);
  const orderDate = formatOrderDateIso(snapshot.createdAt);
  const dueDate = orderDate?.split('T')[0];

  const referencesOrder: Record<string, unknown> = {
    '@type': 'Order',
    orderNumber: opts.ref,
    merchant: orderJsonLd.merchant,
    ...(orderJsonLd.orderDate ? { orderDate: orderJsonLd.orderDate } : {}),
    ...(orderJsonLd.price ? { price: orderJsonLd.price } : {}),
    ...(orderJsonLd.priceCurrency
      ? { priceCurrency: orderJsonLd.priceCurrency }
      : {}),
  };

  const payload: Record<string, unknown> = {
    '@context': 'http://schema.org',
    '@type': 'Invoice',
    accountId: opts.ref,
    confirmationNumber: opts.ref,
    paymentStatus: 'PaymentAutomaticallyApplied',
    paymentMethod: {
      '@type': 'PaymentMethod',
      name: 'http://schema.org/CreditCard',
    },
    provider: { '@type': 'Organization', name: snapshot.storeName },
    customer: { '@type': 'Person', name: snapshot.clientName },
    totalPaymentDue: {
      '@type': 'PriceSpecification',
      price: total,
      priceCurrency: currency,
    },
    minimumPaymentDue: {
      '@type': 'PriceSpecification',
      price: '0.00',
      priceCurrency: currency,
    },
    referencesOrder,
  };

  if (dueDate) {
    payload.paymentDue = dueDate;
    payload.scheduledPaymentDate = dueDate;
  }

  return payload;
}

/** Order + Invoice JSON-LD pour les e-mails de reçu payé. */
export function buildOrderReceiptEmailJsonLd(
  snapshot: OrderInvoiceSnapshot,
  opts: OrderEmailJsonLdOptions,
): Record<string, unknown>[] {
  const order = buildOrderEmailJsonLd(snapshot, opts);
  const invoice = buildInvoiceEmailJsonLd(snapshot, opts, order);
  return [order, invoice];
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
