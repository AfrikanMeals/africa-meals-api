/**
 * Champs d’affichage offre course (sheet livreur call-like).
 * Formules alignées listes historique livreur / formatAddressParts.
 */

export type OfferWithheldFeeSettings = {
  deliveryWithheldFeeMode?: string;
  deliveryWithheldFeeFixed?: number;
  deliveryWithheldFeePercent?: number;
};

/** Gain livreur estimé = shipping − retenue plateforme (même maths DeliveryAgentService). */
export function computeOfferDriverEarning(
  shippingPrice: number,
  settings?: OfferWithheldFeeSettings | null,
): { driverEarning: number; platformWithheld: number } {
  const ship = Math.max(0, Number(shippingPrice) || 0);
  const mode = (settings?.deliveryWithheldFeeMode ?? 'fixed').trim();
  const withheldRaw =
    mode === 'percent'
      ? (ship * (Number(settings?.deliveryWithheldFeePercent) || 0)) / 100
      : Number(settings?.deliveryWithheldFeeFixed) || 0;
  const platformWithheld = Math.min(ship, Math.max(0, withheldRaw));
  const driverEarning = Math.max(
    0,
    Math.round((ship - platformWithheld) * 100) / 100,
  );
  return {
    driverEarning,
    platformWithheld: Math.round(platformWithheld * 100) / 100,
  };
}

/** Ligne adresse depuis snapshot / doc adresse { address, city, zipCode }. */
export function formatOfferAddressLine(
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
  if (!snap) return '';
  const street = String(snap.address ?? '').trim();
  const city = String(snap.city ?? '').trim();
  const zip = String(snap.zipCode ?? snap.zip_code ?? '').trim();
  const cityLine = [city, zip].filter((s) => s.length > 0).join(' ');
  const cc = String(snap.countryCode ?? snap.country_code ?? '').trim();
  const country = String(snap.country ?? '').trim();
  const tail =
    cc === 'CA' || country === 'Canada'
      ? 'Canada'
      : [country, cc].filter((s) => s.length > 0).join(' ');
  return [street, cityLine, tail].filter((s) => s.length > 0).join(', ');
}

export type DeliveryOfferDisplayFields = {
  currency: string;
  shippingPrice: number | null;
  driverEarning: number | null;
  storeAddress: string;
  dropoffAddress: string;
};

/**
 * Champs client pour WS / FCM / GET pending — à partir de la commande + boutique peuplées.
 */
export function buildDeliveryOfferDisplayFields(args: {
  order?: Record<string, unknown> | null;
  store?: Record<string, unknown> | null;
  withheldSettings?: OfferWithheldFeeSettings | null;
}): DeliveryOfferDisplayFields {
  const order = args.order ?? {};
  const store = args.store ?? {};

  const storeCurrency =
    typeof store.currency === 'string' ? store.currency.trim() : '';
  const orderCurrency =
    typeof order.currency === 'string' ? order.currency.trim() : '';
  const currency = (orderCurrency || storeCurrency || 'CAD').toUpperCase();

  const shippingRaw = order.shippingPrice ?? order.shipping_price;
  const shippingPrice =
    shippingRaw == null || shippingRaw === ''
      ? null
      : Math.max(0, Number(shippingRaw) || 0);

  let driverEarning: number | null = null;
  if (shippingPrice != null) {
    driverEarning = computeOfferDriverEarning(
      shippingPrice,
      args.withheldSettings,
    ).driverEarning;
  }

  const storeAddr =
    store.address && typeof store.address === 'object'
      ? (store.address as Record<string, unknown>)
      : null;
  const storeAddress = formatOfferAddressLine(
    storeAddr
      ? {
          address: String(storeAddr.address ?? ''),
          city: String(storeAddr.city ?? ''),
          zipCode: String(storeAddr.zipCode ?? storeAddr.zip_code ?? ''),
          country: String(storeAddr.country ?? ''),
          countryCode: String(
            storeAddr.countryCode ?? storeAddr.country_code ?? '',
          ),
        }
      : null,
  );

  const dropSnap =
    order.deliveryAddressSnapshot ?? order.delivery_address_snapshot;
  const dropoffAddress =
    dropSnap && typeof dropSnap === 'object'
      ? formatOfferAddressLine(
          dropSnap as {
            address?: string;
            city?: string;
            zipCode?: string;
            zip_code?: string;
            country?: string;
            countryCode?: string;
            country_code?: string;
          },
        )
      : '';

  return {
    currency,
    shippingPrice,
    driverEarning,
    storeAddress,
    dropoffAddress,
  };
}
