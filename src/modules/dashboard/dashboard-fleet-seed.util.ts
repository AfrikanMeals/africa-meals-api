/** Compte courses actives pour le snapshot flotte (seed SSE). */
export function fleetActiveOrderCountFromLivreurRow(row: {
  statut: string;
  commande_en_cours?: unknown;
}): number {
  return row.statut === 'en_livraison' || row.commande_en_cours ? 1 : 0;
}

/** GPS livreur depuis candidature approuvée (notify WS assignation). */
export function courierTrackingExtraFromApplication(application: {
  lastLatitude?: number | null;
  lastLongitude?: number | null;
} | null): { courierLatitude?: number; courierLongitude?: number } {
  const lat = application?.lastLatitude;
  const lng = application?.lastLongitude;
  if (
    typeof lat !== 'number' ||
    typeof lng !== 'number' ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    (lat === 0 && lng === 0)
  ) {
    return {};
  }
  return { courierLatitude: lat, courierLongitude: lng };
}
