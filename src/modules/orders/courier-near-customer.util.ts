/**
 * Géofence « livreur proche de l’adresse client » — one-shot push/email.
 * Seuil configurable Admin (défaut 500 m) ; distance haversine en km côté tracking.
 */

import {
  DEFAULT_COURIER_NEAR_CUSTOMER_RADIUS_METERS,
  MAX_COURIER_NEAR_CUSTOMER_RADIUS_METERS,
} from '@modules/checkout-delivery-settings/checkout-delivery-settings.util';

/** Défaut produit si settings absents. */
export const COURIER_NEAR_CUSTOMER_THRESHOLD_METERS =
  DEFAULT_COURIER_NEAR_CUSTOMER_RADIUS_METERS;

/** Max configurable — fast-reject GPS hors portée sans lire Mongo. */
export const COURIER_NEAR_CUSTOMER_THRESHOLD_METERS_MAX =
  MAX_COURIER_NEAR_CUSTOMER_RADIUS_METERS;

/** Convertit un seuil en mètres vers km (aligné sur `haversineDistance` / `remainingDistanceKm`). */
export function courierNearThresholdKm(
  meters: number = COURIER_NEAR_CUSTOMER_THRESHOLD_METERS,
): number {
  return Math.max(0, Number(meters) || 0) / 1000;
}

/**
 * Vrai si la distance restante livreur → client est dans le rayon.
 * `remainingKm` vient du tracking (`remainingDistanceKm`), déjà en kilomètres.
 */
export function isCourierWithinNearCustomerRadius(
  remainingKm: number | null | undefined,
  thresholdMeters: number = COURIER_NEAR_CUSTOMER_THRESHOLD_METERS,
): boolean {
  if (remainingKm == null || !Number.isFinite(Number(remainingKm))) {
    return false;
  }
  return Number(remainingKm) <= courierNearThresholdKm(thresholdMeters);
}

/**
 * Décide si on doit notifier (géofence + pas encore notifié + course encore active).
 * Ne gère pas les prefs canaux — à vérifier après claim atomique.
 */
export function shouldAttemptCourierNearCustomerNotify(args: {
  remainingKm: number | null | undefined;
  alreadyNotifiedAt?: Date | string | null;
  /** Preuve client absent déjà déposée → plus d’alerte « proche ». */
  hasPendingDeliveryProof?: boolean;
  thresholdMeters?: number;
}): boolean {
  if (args.alreadyNotifiedAt) return false;
  if (args.hasPendingDeliveryProof) return false;
  return isCourierWithinNearCustomerRadius(
    args.remainingKm,
    args.thresholdMeters ?? COURIER_NEAR_CUSTOMER_THRESHOLD_METERS,
  );
}
