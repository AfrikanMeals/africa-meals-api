import {
  resolveProductPublicUrl as buildCatalogProductPublicUrl,
} from '@common/catalog-public-url.util';
import {
  customizationSummaryLabel,
  normalizeSelectedComplements,
  normalizeSelectedSupplements,
} from '@modules/cart/cart-customization.util';
import type { OrdeLineItem } from '@schemas/order.schema';
import { haversineDistance } from '@utils/helpers';

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
  deliveryTipCents?: number;
  shouldShip?: boolean;
  currency?: string;
  couponCode?: string;
  pickupCode?: string;
  storeName: string;
  storeAddressLine?: string;
  /** Adresse restaurant (origine livraison) pour ParcelDelivery. */
  storeAddressSnapshot?: {
    address?: string;
    city?: string;
    zipCode?: string;
    zip_code?: string;
    country?: string;
    countryCode?: string;
    country_code?: string;
    location?: { coordinates?: number[] };
  };
  /** [longitude, latitude] — adresse restaurant. */
  storeAddressCoords?: [number, number];
  /** Livreur assigné (nom affiché comme transporteur). */
  carrierName?: string;
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

/**
 * Objet e-mail pour la carte achat Gmail (« Your … order is now complete »).
 * Conserve « Receipt » / « Order » pour l’onglet Achats.
 */
export function orderReceiptEmailSubject(
  storeName: string,
  ref: string,
): string {
  const store = storeName.trim() || 'Restaurant';
  return `Your ${store} order #${ref} is now complete`;
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

/** URL publique d'un produit (boutique + article) pour le balisage Gmail / Merchant. */
export function resolveProductPublicUrl(
  storeId: string | undefined,
  entityId: string | undefined,
  publicWebUrl?: string | null,
  storeName?: string | null,
  productTitle?: string | null,
): string | undefined {
  const productId = entityId?.trim();
  const base = publicWebUrl?.trim();
  if (!productId || !base) return undefined;
  const root = base.replace(/\/+$/, '');
  if (storeId?.trim()) {
    return buildCatalogProductPublicUrl(
      root,
      storeId.trim(),
      productId,
      storeName,
      productTitle,
    );
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
      const url = resolveProductPublicUrl(
        storeId,
        sku,
        publicWebUrl,
        storeName,
        name,
      );
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

  return resolveOrderPublicUrl('https://wise-eat.com', id);
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
  processing: 'https://schema.org/OrderProcessing',
  delivered: 'https://schema.org/OrderDelivered',
  problem: 'https://schema.org/OrderProblem',
  cancelled: 'https://schema.org/OrderCancelled',
} as const;

/** Statut livraison (ParcelDelivery.deliveryStatus). */
export const ParcelDeliverySchemaStatus = {
  inTransit: 'InTransit',
} as const;

export function coordsFromAddressLike(addr: unknown): [number, number] | undefined {
  if (!addr || typeof addr !== 'object') return undefined;
  const loc = (addr as { location?: { coordinates?: unknown } }).location;
  const c = loc?.coordinates;
  if (Array.isArray(c) && c.length >= 2) {
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return [lng, lat];
    }
  }
  return undefined;
}

/** ETA livraison (minutes) — aligné sur delivery-agent `etaLabelFromKm`. */
export function estimateParcelDeliveryEtaMinutes(distanceKm?: number): number {
  if (distanceKm != null && Number.isFinite(distanceKm)) {
    return Math.max(15, Math.round(distanceKm * 4 + 10));
  }
  return 45;
}

export function estimateParcelDeliveryEtaUntilIso(
  distanceKm?: number,
  from?: Date,
): string {
  const base = from ?? new Date();
  const minutes = estimateParcelDeliveryEtaMinutes(distanceKm);
  return new Date(base.getTime() + minutes * 60 * 1000).toISOString();
}

export function estimateParcelDeliveryDistanceKm(
  snapshot: OrderInvoiceSnapshot,
): number | undefined {
  const store = snapshot.storeAddressCoords;
  const dest = coordsFromAddressLike(snapshot.deliveryAddressSnapshot);
  if (store && dest) {
    return +haversineDistance(store, dest).toFixed(2);
  }
  return undefined;
}

function resolvePostalCountry(
  snap: {
    country?: string;
    countryCode?: string;
    country_code?: string;
  },
): string {
  const cc = snap.countryCode ?? snap.country_code ?? snap.country;
  if (cc === 'CA' || snap.country === 'Canada') return 'CA';
  if (typeof cc === 'string' && cc.trim()) return cc.trim();
  if (typeof snap.country === 'string' && snap.country.trim()) {
    return snap.country.trim();
  }
  return 'CA';
}

function buildParcelPostalAddress(
  snap: {
    address?: string;
    city?: string;
    zipCode?: string;
    zip_code?: string;
    country?: string;
    countryCode?: string;
    country_code?: string;
  },
  name: string,
): Record<string, unknown> | undefined {
  const streetAddress = String(snap.address ?? '').trim();
  if (!streetAddress) return undefined;

  const locality = String(snap.city ?? '').trim();
  const postal = String(snap.zipCode ?? snap.zip_code ?? '').trim();
  const addressCountry = resolvePostalCountry(snap);
  const addressRegion = postal || locality || addressCountry;

  return {
    '@type': 'PostalAddress',
    name: name.trim() || 'Recipient',
    streetAddress,
    addressLocality: locality || addressRegion,
    addressRegion,
    postalCode: postal || '00000',
    addressCountry,
  };
}

export type OrderEmailJsonLdOptions = {
  /** Numéro de commande affiché (ex. 8 derniers caractères). */
  ref: string;
  /** URL Schema.org (cf. OrderSchemaStatus). Défaut : processing. */
  orderStatus?: string;
  /** URL publique de la commande (https). Active le bouton « Voir la commande ». */
  orderUrl?: string;
  /** Base site public pour les URLs produit dans acceptedOffer. */
  publicWebUrl?: string;
  /** Logo marchand (recommandé pour la carte achat Gmail). */
  merchantLogoUrl?: string;
  /** Libellé du bouton d'action. */
  actionName?: string;
};

export function firstOrderItemImageUrl(
  snapshot: OrderInvoiceSnapshot,
): string | undefined {
  for (const it of snapshot.items ?? []) {
    const row = it as { pictureUrl?: string; picture_url?: string };
    const url = String(row.pictureUrl ?? row.picture_url ?? '').trim();
    if (/^https?:\/\//i.test(url)) return url;
  }
  return undefined;
}

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

  const merchant: Record<string, unknown> = {
    '@type': 'Organization',
    name: snapshot.storeName,
  };
  const logo = opts.merchantLogoUrl?.trim();
  if (logo && /^https?:\/\//i.test(logo)) {
    merchant.logo = logo;
    merchant.image = logo;
  }

  const payload: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Order',
    merchant,
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
    '@context': 'https://schema.org',
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

/**
 * JSON-LD Order seul — requis pour la carte achat Gmail (Invoice séparé peut bloquer le parseur).
 */
export function buildOrderReceiptEmailJsonLd(
  snapshot: OrderInvoiceSnapshot,
  opts: OrderEmailJsonLdOptions,
): Record<string, unknown> {
  return buildOrderEmailJsonLd(snapshot, opts);
}

export type ParcelDeliveryEmailJsonLdOptions = OrderEmailJsonLdOptions & {
  /** Nom de la plateforme (transporteur par défaut). */
  appName?: string;
  /** Nom du livreur ou transporteur affiché dans `carrier`. */
  carrierName?: string;
};

/**
 * Balisage Schema.org `ParcelDelivery` pour les e-mails de suivi livraison.
 * @see https://developers.google.com/workspace/gmail/markup/reference/parcel-delivery
 */
export function buildParcelDeliveryEmailJsonLd(
  snapshot: OrderInvoiceSnapshot,
  opts: ParcelDeliveryEmailJsonLdOptions,
): Record<string, unknown> | undefined {
  if (!snapshot.shouldShip) return undefined;

  const deliveryAddress = buildParcelPostalAddress(
    (snapshot.deliveryAddressSnapshot ?? {}) as {
      address?: string;
      city?: string;
      zipCode?: string;
      zip_code?: string;
      country?: string;
      countryCode?: string;
      country_code?: string;
    },
    snapshot.clientName.trim() || snapshot.clientEmail,
  );
  if (!deliveryAddress) return undefined;

  const distanceKm = estimateParcelDeliveryDistanceKm(snapshot);
  const expectedArrivalUntil = estimateParcelDeliveryEtaUntilIso(distanceKm);
  const carrierLabel =
    (
      opts.carrierName ??
      snapshot.carrierName ??
      opts.appName ??
      'Wise Eat'
    ).trim() || 'Wise Eat';
  const orderUrl = opts.orderUrl?.trim();
  const storeName = snapshot.storeName.trim() || 'Restaurant';

  const merchant: Record<string, unknown> = {
    '@type': 'Organization',
    name: storeName,
  };
  const logo = opts.merchantLogoUrl?.trim();
  if (logo && /^https?:\/\//i.test(logo)) {
    merchant.logo = logo;
  }

  const partOfOrder: Record<string, unknown> = {
    '@type': 'Order',
    orderNumber: opts.ref,
    merchant,
    orderStatus: OrderSchemaStatus.processing,
  };

  const firstRow = snapshot.items?.[0] as LineItemRow | undefined;
  const firstName = String(firstRow?.label ?? '').trim();
  const itemShipped: Record<string, unknown> = {
    '@type': 'Product',
    name: firstName || `Commande ${storeName}`,
  };
  const sku = String(firstRow?.entityId ?? firstRow?.entity_id ?? '').trim();
  const image = String(
    firstRow?.pictureUrl ?? firstRow?.picture_url ?? '',
  ).trim();
  const productUrl = resolveProductPublicUrl(
    snapshot.storeId,
    sku || undefined,
    opts.publicWebUrl,
    storeName,
    firstName || undefined,
  );
  if (sku) itemShipped.sku = sku;
  if (image && /^https?:\/\//i.test(image)) itemShipped.image = image;
  if (productUrl) itemShipped.url = productUrl;

  const payload: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'ParcelDelivery',
    deliveryAddress,
    expectedArrivalUntil,
    carrier: { '@type': 'Organization', name: carrierLabel },
    itemShipped,
    partOfOrder,
    trackingNumber: opts.ref,
    deliveryStatus: ParcelDeliverySchemaStatus.inTransit,
    hasDeliveryMethod: {
      '@type': 'ParcelService',
      name: 'http://schema.org/ParcelService',
    },
  };

  const originSnap = snapshot.storeAddressSnapshot;
  if (originSnap) {
    const originAddress = buildParcelPostalAddress(originSnap, storeName);
    if (originAddress) payload.originAddress = originAddress;
  }

  if (orderUrl) {
    payload.trackingUrl = orderUrl;
    payload.potentialAction = {
      '@type': 'TrackAction',
      url: orderUrl,
    };
  }

  return payload;
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
