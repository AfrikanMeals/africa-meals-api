/** Clé singleton Mongo `checkout_delivery_settings`. */
export const CHECKOUT_DELIVERY_SETTINGS_KEY = 'default';

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
  updatedAt?: Date | string | null;
}): {
  hideDeliveryWhenNoCourierAvailable: boolean;
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
    updatedAt,
  };
}
