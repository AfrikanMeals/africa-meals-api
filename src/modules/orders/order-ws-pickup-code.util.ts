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
