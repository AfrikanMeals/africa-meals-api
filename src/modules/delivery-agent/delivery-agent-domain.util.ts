import type { AgentPresenceValue } from '../../common/domain-events/payloads/agent-domain-event.payloads';

export const AGENT_LOCATION_EMIT_THROTTLE_MS = 10_000;

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
