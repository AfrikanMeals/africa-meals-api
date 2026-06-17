/**
 * Vocabulaire d'événements domaine Wise Eat.
 * Règle : le `type` est immuable ; évolution = nouveau `version` ou nouveau `type`.
 */
export const DOMAIN_EVENT_TYPES = [
  // Commandes (EDA-004)
  'order.created',
  'order.paid',
  'order.approved',
  'order.shipped',
  'order.delivered',
  'order.cancelled',
  'order.tracking.updated',
  // Paiements & abonnements (EDA-006)
  'payment.checkout.completed',
  'payment.intent.succeeded',
  'payment.connect.account.updated',
  'subscription.checkout.completed',
  'subscription.trial.ending',
  // Livreurs (EDA-007)
  'agent.presence.changed',
  'agent.location.updated',
  'agent.capacity.changed',
  // Publicité (EDA-008)
  'ad.impression',
  'ad.click',
  'ad.conversion',
  // Jobs admin (SSE-006)
  'job.progress',
  'job.completed',
  'job.failed',
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export function isDomainEventType(value: string): value is DomainEventType {
  return (DOMAIN_EVENT_TYPES as readonly string[]).includes(value);
}

/** Préfixe MQTT / topic bus (configurable via env dans EDA-002). */
export const DOMAIN_EVENT_TOPIC_PREFIX = 'africameals/domain';

export function domainEventTopicFor(type: DomainEventType): string {
  return `${DOMAIN_EVENT_TOPIC_PREFIX}/${type}`;
}
