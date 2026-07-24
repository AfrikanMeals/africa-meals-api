/** Clé singleton Mongo `checkout_delivery_settings`. */
export const CHECKOUT_DELIVERY_SETTINGS_KEY = 'default';

/** Défaut produit — aligné sur l’alerte « livreur proche » historique. */
export const DEFAULT_COURIER_NEAR_CUSTOMER_RADIUS_METERS = 500;

/** Bornes admin : évite 0 (spam immédiat) et rayons absurdes. */
export const MIN_COURIER_NEAR_CUSTOMER_RADIUS_METERS = 50;
export const MAX_COURIER_NEAR_CUSTOMER_RADIUS_METERS = 5000;

/**
 * Normalise le flag plateforme : seule la valeur booléenne `true` active le masquage.
 * Absents / null / chaînes → false (fail-open : ne pas cacher Livraison).
 */
export function normalizeHideDeliveryWhenNoCourierAvailable(
  value: unknown,
): boolean {
  return value === true;
}

/**
 * Rayon alerte « livreur proche » en mètres entiers.
 * Invalide / hors bornes → défaut 500.
 */
export function normalizeCourierNearCustomerRadiusMeters(
  value: unknown,
): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    return DEFAULT_COURIER_NEAR_CUSTOMER_RADIUS_METERS;
  }
  const rounded = Math.round(n);
  if (
    rounded < MIN_COURIER_NEAR_CUSTOMER_RADIUS_METERS ||
    rounded > MAX_COURIER_NEAR_CUSTOMER_RADIUS_METERS
  ) {
    return DEFAULT_COURIER_NEAR_CUSTOMER_RADIUS_METERS;
  }
  return rounded;
}

/**
 * Payload upsert PUT — `$setOnInsert` ne doit jamais répéter un path de `$set`
 * (sinon Mongo : « Updating the path … would create a conflict » sur 1er insert).
 */
export function buildCheckoutDeliverySettingsUpsertUpdate(
  patch: Record<string, unknown>,
): {
  $set: Record<string, unknown>;
  $setOnInsert: { key: string };
} {
  return {
    $set: patch,
    $setOnInsert: { key: CHECKOUT_DELIVERY_SETTINGS_KEY },
  };
}

/** Réponse publique / admin du singleton checkout-delivery-settings. */
export function toCheckoutDeliverySettingsResponse(doc: {
  hideDeliveryWhenNoCourierAvailable?: unknown;
  courierNearCustomerRadiusMeters?: unknown;
  updatedAt?: Date | string | null;
}): {
  hideDeliveryWhenNoCourierAvailable: boolean;
  courierNearCustomerRadiusMeters: number;
  updatedAt: string | null;
} {
  const rawUpdated = doc.updatedAt;
  let updatedAt: string | null = null;
  if (rawUpdated instanceof Date) {
    updatedAt = rawUpdated.toISOString();
  } else if (typeof rawUpdated === 'string' && rawUpdated.trim()) {
    updatedAt = rawUpdated;
  }
  return {
    hideDeliveryWhenNoCourierAvailable:
      normalizeHideDeliveryWhenNoCourierAvailable(
        doc.hideDeliveryWhenNoCourierAvailable,
      ),
    courierNearCustomerRadiusMeters: normalizeCourierNearCustomerRadiusMeters(
      doc.courierNearCustomerRadiusMeters,
    ),
    updatedAt,
  };
}
