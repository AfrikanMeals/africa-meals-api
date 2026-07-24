/**
 * Normalise le flag plateforme : seule la valeur booléenne `true` active le masquage.
 * Absents / null / chaînes → false (fail-open : ne pas cacher Livraison).
 */
export function normalizeHideDeliveryWhenNoCourierAvailable(
  value: unknown,
): boolean {
  return value === true;
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
