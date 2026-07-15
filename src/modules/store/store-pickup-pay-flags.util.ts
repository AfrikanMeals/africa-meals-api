/**
 * Flags paiement cash au retrait (pickup) — lecture doc Mongo (camelCase / snake_case).
 * Utilisé par le résumé vendeur et le méta catalogue public.
 */

export function docAcceptsPickupPayOnDelivery(
  doc: Record<string, unknown>,
): boolean {
  return (
    doc.acceptsPickupPayOnDelivery === true ||
    doc.accepts_pickup_pay_on_delivery === true
  );
}

/** Pré-sélection checkout : uniquement si le paiement à la collecte est actif. */
export function docDefaultPickupPayOnPickup(
  doc: Record<string, unknown>,
): boolean {
  if (!docAcceptsPickupPayOnDelivery(doc)) return false;
  return (
    doc.defaultPickupPayOnPickup === true ||
    doc.default_pickup_pay_on_pickup === true
  );
}

export function normalizeDefaultPickupPayOnPickupFlag(
  value: boolean | undefined,
  acceptsPickupPayOnDelivery: boolean,
): boolean {
  if (!acceptsPickupPayOnDelivery) return false;
  return value === true;
}
