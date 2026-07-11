import type { AgentPresenceValue } from '../../common/domain-events/payloads/agent-domain-event.payloads';
import {
  normalizeRegionCode,
  resolvePlatformShippingRegionCode,
} from '../platform-shipping-settings/platform-shipping-region.util';

export const AGENT_LOCATION_EMIT_THROTTLE_MS = 10_000;

/**
 * Région d’exercice du livreur : dossier candidature (`region`) prioritaire
 * sur `user.appCountryCode` (profil client / legacy).
 */
export function resolveAgentOperatingRegionCode(
  applicationRegion?: string | null,
  userAppCountryCode?: string | null,
): string | undefined {
  return resolvePlatformShippingRegionCode([
    applicationRegion,
    userAppCountryCode,
  ]);
}

export type DeliveryAgentPresenceLabel =
  | 'disponible'
  | 'en_livraison'
  | 'hors_ligne';

export function mapDeliveryPresenceToDomain(
  presence: DeliveryAgentPresenceLabel,
): AgentPresenceValue {
  if (presence === 'en_livraison') return 'busy';
  if (presence === 'hors_ligne') return 'offline';
  return 'available';
}

export function resolveDeliveryAgentPresence(
  availability: 'disponible' | 'hors_ligne',
  activeOrderCount: number,
): DeliveryAgentPresenceLabel {
  if (availability === 'hors_ligne') return 'hors_ligne';
  if (activeOrderCount > 0) return 'en_livraison';
  return 'disponible';
}

/** Distance restaurant → client dans le rayon max configuré (admin livraison). */
export function pendingOrderWithinMaxDeliveryRadius(
  distanceKm: number | null | undefined,
  maxDeliveryRadiusKm: number,
): boolean {
  if (distanceKm == null || !Number.isFinite(distanceKm)) return false;
  if (maxDeliveryRadiusKm <= 0) return false;
  return distanceKm <= maxDeliveryRadiusKm + 1e-9;
}

/** La boutique doit être dans la même région ISO2 que le livreur. */
export function pendingOrderMatchesAgentOperatingRegion(
  storeRegionCode: string | null | undefined,
  agentRegionCode: string | null | undefined,
): boolean {
  const agent = normalizeRegionCode(agentRegionCode);
  if (!agent) return true;
  const store = normalizeRegionCode(storeRegionCode);
  // Boutique sans région connue : ne pas masquer la course (données incomplètes).
  if (!store) return true;
  return store === agent;
}

/** Distance livreur → restaurant dans le rayon max (côté mobile avec GPS). */
export function pendingOrderWithinAgentToStoreRadius(
  agentToStoreKm: number | null | undefined,
  maxDeliveryRadiusKm: number,
): boolean {
  if (agentToStoreKm == null || !Number.isFinite(agentToStoreKm)) return true;
  if (maxDeliveryRadiusKm <= 0) return false;
  return agentToStoreKm <= maxDeliveryRadiusKm + 1e-9;
}
