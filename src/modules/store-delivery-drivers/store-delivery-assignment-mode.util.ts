import { StoreDeliveryAssignmentModeEnum } from '@schemas/store.schema';

/**
 * Normalise le mode d’assignation flotte boutique.
 * Défaut produit : SEMI_AUTO (ex-comportement « livreurs prennent »).
 * Legacy : valeurs inconnues → SEMI_AUTO (pas AUTO hard-assign).
 */
export function normalizeStoreDeliveryAssignmentMode(
  raw: unknown,
): StoreDeliveryAssignmentModeEnum {
  const v = String(raw ?? '')
    .trim()
    .toUpperCase();
  if (v === StoreDeliveryAssignmentModeEnum.MANUAL) {
    return StoreDeliveryAssignmentModeEnum.MANUAL;
  }
  if (v === StoreDeliveryAssignmentModeEnum.AUTO) {
    return StoreDeliveryAssignmentModeEnum.AUTO;
  }
  if (v === StoreDeliveryAssignmentModeEnum.SEMI_AUTO) {
    return StoreDeliveryAssignmentModeEnum.SEMI_AUTO;
  }
  // Défaut + legacy inconnu : claim/cascade (pas hard-assign silencieux).
  return StoreDeliveryAssignmentModeEnum.SEMI_AUTO;
}

/** Claim livreur / file pending ouverte : Semi-auto uniquement. */
export function allowsCourierSelfClaim(
  mode: StoreDeliveryAssignmentModeEnum | string,
): boolean {
  return (
    normalizeStoreDeliveryAssignmentMode(mode) ===
    StoreDeliveryAssignmentModeEnum.SEMI_AUTO
  );
}

/** Cascade d’offres exclusives au mark-ready (sans hard-assign). */
export function usesOfferCascade(
  mode: StoreDeliveryAssignmentModeEnum | string,
): boolean {
  return (
    normalizeStoreDeliveryAssignmentMode(mode) ===
    StoreDeliveryAssignmentModeEnum.SEMI_AUTO
  );
}

/** Hard-assign système au meilleur candidat (score / distance / perf). */
export function usesHardAutoAssign(
  mode: StoreDeliveryAssignmentModeEnum | string,
): boolean {
  return (
    normalizeStoreDeliveryAssignmentMode(mode) ===
    StoreDeliveryAssignmentModeEnum.AUTO
  );
}
