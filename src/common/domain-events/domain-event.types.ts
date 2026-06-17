import type { DomainEventType } from './domain-event-types';
import type { DomainEventPayloadMap } from './payloads';

/** Métadonnées optionnelles transportées avec chaque événement domaine. */
export interface DomainEventMetadata {
  /** Chaîne de corrélation (ex. requête HTTP, webhook Stripe). */
  correlationId?: string;
  /** ID de l'événement ayant causé celui-ci. */
  causationId?: string;
  /** Utilisateur à l'origine de l'action métier. */
  actorUserId?: string;
  /** Composant émetteur (`orders`, `stripe-webhook`, …). */
  source?: string;
  /** Contexte fulfillment Stripe (EDA-006) — non validé côté registry. */
  stripeFulfillment?: Record<string, unknown>;
  /** Contexte abonnement vendeur via PaymentIntent (EDA-006). */
  stripeSubscriptionIntent?: Record<string, unknown>;
  /** Contexte transition commande (fromStatus, wsTracking, vendorUserId, deliveryAgentId, …). */
  orderContext?: Record<string, unknown>;
  /** Compte Stripe Connect (EDA-009) — objet webhook `account.updated`. */
  stripeConnectAccount?: Record<string, unknown>;
}

/**
 * Enveloppe standard d'un événement domaine Wise Eat.
 * Distincte du journal d'audit `order_status_events`.
 */
export interface DomainEventEnvelope<
  TPayload = DomainEventPayloadMap[DomainEventType],
> {
  /** UUID v4 — clé d'idempotence (EDA-002). */
  id: string;
  /** Identifiant immuable du type d'événement (`order.paid`, …). */
  type: DomainEventType;
  /** Version du schéma payload pour ce `type`. */
  version: number;
  /** Horodatage ISO 8601 (UTC). */
  occurredAt: string;
  payload: TPayload;
  metadata?: DomainEventMetadata;
}

export type DomainEventEnvelopeFor<T extends DomainEventType> =
  DomainEventEnvelope<DomainEventPayloadMap[T]>;

/** Entrée minimale pour construire un événement avant validation / publication. */
export interface DomainEventDraft<T extends DomainEventType = DomainEventType> {
  type: T;
  payload: DomainEventPayloadMap[T];
  metadata?: DomainEventMetadata;
  id?: string;
  occurredAt?: string;
  version?: number;
}
