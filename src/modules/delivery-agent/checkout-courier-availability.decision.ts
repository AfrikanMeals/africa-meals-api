import { StoreDeliveryAssignmentModeEnum } from '@schemas/store.schema';

export type CheckoutCourierAvailabilityState =
  | 'available'
  | 'unavailable'
  | 'unknown';

export type CheckoutCourierAvailabilityRow = {
  storeId: string;
  state: CheckoutCourierAvailabilityState;
  strategy: 'store_fleet' | 'platform';
  reason?: string;
};

export type CheckoutCourierAvailabilityDecisionInput = {
  storeId: string;
  supportsShipping: boolean;
  /** `vendorManagesDeliveryDrivers` — flotte / livraison gérée par la boutique. */
  managed: boolean;
  /** Plan abonnement « livraison autonome » (self-shipping vendeur). */
  selfDeliveryRequired: boolean;
  assignmentMode: StoreDeliveryAssignmentModeEnum | string;
  /** Au moins un membre flotte assignable (présence + capacité). */
  fleetHasAssignable: boolean;
  /**
   * Pool plateforme : `true` / `false` / `null` si géoloc boutique absente
   * (fail-open côté client via `unknown`).
   */
  platformHasAssignable: boolean | null;
};

/**
 * Décide la dispo Livraison checkout (pur) :
 * flotte → self-shipping / flotte gérée → pool plateforme.
 *
 * Fix: un plan self-shipping ou une flotte gérée ne doit plus masquer Livraison
 * quand aucun livreur plateforme n’est en ligne — le vendeur peut s’assigner.
 */
export function decideCheckoutCourierAvailability(
  input: CheckoutCourierAvailabilityDecisionInput,
): CheckoutCourierAvailabilityRow {
  const storeId = String(input.storeId ?? '').trim();
  const strategyManaged: CheckoutCourierAvailabilityRow['strategy'] =
    input.managed ? 'store_fleet' : 'platform';

  if (!input.supportsShipping) {
    return {
      storeId,
      state: 'unavailable',
      strategy: strategyManaged,
      reason: 'store_shipping_disabled',
    };
  }

  // 1. Membre flotte réellement assignable.
  if (input.managed && input.fleetHasAssignable) {
    return { storeId, state: 'available', strategy: 'store_fleet' };
  }

  // 2. Self-shipping vendeur ou flotte gérée : Livraison proposée sans courier live.
  if (input.selfDeliveryRequired || input.managed) {
    return {
      storeId,
      state: 'available',
      strategy: 'store_fleet',
      reason: input.selfDeliveryRequired
        ? 'vendor_self_delivery'
        : 'vendor_managed_delivery',
    };
  }

  // 3. Boutique non gérée : pool plateforme uniquement.
  if (input.platformHasAssignable == null) {
    return {
      storeId,
      state: 'unknown',
      strategy: 'platform',
      reason: 'store_location_unavailable',
    };
  }
  if (input.platformHasAssignable) {
    return { storeId, state: 'available', strategy: 'platform' };
  }

  return {
    storeId,
    state: 'unavailable',
    strategy: 'platform',
    reason: 'no_online_courier',
  };
}
