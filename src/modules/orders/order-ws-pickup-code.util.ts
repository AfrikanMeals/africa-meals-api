/**
 * Extrait le code retrait/livraison pour le payload WS suivi.
 * Le client fusionne `pickupCode` dans l’état local — sans ce champ le statut
 * passe à « prête » sans afficher le code.
 */
export function readOrderPickupCodeForWs(
  order: Record<string, unknown> | { pickupCode?: string; pickup_code?: string },
): string | undefined {
  const raw = String(
    (order as { pickupCode?: unknown }).pickupCode ??
      (order as { pickup_code?: unknown }).pickup_code ??
      '',
  ).trim();
  return raw.length >= 4 ? raw.toUpperCase() : undefined;
}

/**
 * Retire le code retrait/livraison d’un payload WS.
 * Invariant : vendeur / livreur ne doivent jamais recevoir `pickupCode`
 * (seul client + admin support).
 */
export function stripPickupCodeFromWsPayload<T extends Record<string, unknown>>(
  payload: T,
): T {
  if (
    !Object.prototype.hasOwnProperty.call(payload, 'pickupCode') &&
    !Object.prototype.hasOwnProperty.call(payload, 'pickup_code')
  ) {
    return payload;
  }
  const next = { ...payload };
  delete next.pickupCode;
  delete next.pickup_code;
  return next;
}
