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
