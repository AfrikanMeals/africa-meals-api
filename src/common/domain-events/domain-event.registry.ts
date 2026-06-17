import { validateSync, ValidationError } from 'class-validator';
import { randomUUID } from 'crypto';
import {
  DomainEventTypeNotRegisteredError,
  DomainEventValidationError,
  DomainEventVersionMismatchError,
} from './domain-event.errors';
import {
  DOMAIN_EVENT_TYPES,
  DomainEventType,
  isDomainEventType,
} from './domain-event-types';
import {
  DomainEventDraft,
  DomainEventEnvelope,
  DomainEventEnvelopeFor,
  DomainEventMetadata,
} from './domain-event.types';
import {
  AdClickPayload,
  AdConversionPayload,
  AdImpressionPayload,
  AgentCapacityChangedPayload,
  AgentLocationUpdatedPayload,
  AgentPresenceChangedPayload,
  DomainEventPayloadClass,
  DomainEventPayloadMap,
  JobCompletedPayload,
  JobFailedPayload,
  JobProgressPayload,
  OrderApprovedPayload,
  OrderCancelledPayload,
  OrderCreatedPayload,
  OrderDeliveredPayload,
  OrderPaidPayload,
  OrderShippedPayload,
  OrderTrackingUpdatedPayload,
  PaymentCheckoutCompletedPayload,
  PaymentConnectAccountUpdatedPayload,
  PaymentIntentSucceededPayload,
  SubscriptionCheckoutCompletedPayload,
  SubscriptionTrialEndingPayload,
} from './payloads';

const DOMAIN_EVENT_SCHEMA_VERSION = 1;

type RegistryEntry<T extends DomainEventType = DomainEventType> = {
  version: number;
  payloadClass: DomainEventPayloadClass<T>;
};

function flattenValidationErrors(errors: ValidationError[]): string[] {
  const out: string[] = [];
  for (const err of errors) {
    if (err.constraints) {
      out.push(...Object.values(err.constraints));
    }
    if (err.children?.length) {
      out.push(...flattenValidationErrors(err.children));
    }
  }
  return out;
}

function validatePayload<T extends DomainEventType>(
  payloadClass: DomainEventPayloadClass<T>,
  payload: unknown,
  type: T,
): DomainEventPayloadMap[T] {
  const instance = Object.assign(new payloadClass(), payload ?? {});
  const errors = validateSync(instance as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length > 0) {
    throw new DomainEventValidationError(
      `Invalid payload for domain event ${type}`,
      { type, fieldErrors: flattenValidationErrors(errors) },
    );
  }
  return instance;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function assertIsoDate(value: string): void {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new DomainEventValidationError('occurredAt must be a valid ISO 8601 date');
  }
}

/** Registry central : type → validateur payload (class-validator) + version schéma. */
export const DOMAIN_EVENT_REGISTRY: {
  readonly [T in DomainEventType]: RegistryEntry<T>;
} = {
  'order.created': {
    version: DOMAIN_EVENT_SCHEMA_VERSION,
    payloadClass: OrderCreatedPayload,
  },
  'order.paid': {
    version: DOMAIN_EVENT_SCHEMA_VERSION,
    payloadClass: OrderPaidPayload,
  },
  'order.approved': {
    version: DOMAIN_EVENT_SCHEMA_VERSION,
    payloadClass: OrderApprovedPayload,
  },
  'order.shipped': {
    version: DOMAIN_EVENT_SCHEMA_VERSION,
    payloadClass: OrderShippedPayload,
  },
  'order.delivered': {
    version: DOMAIN_EVENT_SCHEMA_VERSION,
    payloadClass: OrderDeliveredPayload,
  },
  'order.cancelled': {
    version: DOMAIN_EVENT_SCHEMA_VERSION,
    payloadClass: OrderCancelledPayload,
  },
  'order.tracking.updated': {
    version: DOMAIN_EVENT_SCHEMA_VERSION,
    payloadClass: OrderTrackingUpdatedPayload,
  },
  'payment.checkout.completed': {
    version: DOMAIN_EVENT_SCHEMA_VERSION,
    payloadClass: PaymentCheckoutCompletedPayload,
  },
  'payment.intent.succeeded': {
    version: DOMAIN_EVENT_SCHEMA_VERSION,
    payloadClass: PaymentIntentSucceededPayload,
  },
  'payment.connect.account.updated': {
    version: DOMAIN_EVENT_SCHEMA_VERSION,
    payloadClass: PaymentConnectAccountUpdatedPayload,
  },
  'subscription.checkout.completed': {
    version: DOMAIN_EVENT_SCHEMA_VERSION,
    payloadClass: SubscriptionCheckoutCompletedPayload,
  },
  'subscription.trial.ending': {
    version: DOMAIN_EVENT_SCHEMA_VERSION,
    payloadClass: SubscriptionTrialEndingPayload,
  },
  'agent.presence.changed': {
    version: DOMAIN_EVENT_SCHEMA_VERSION,
    payloadClass: AgentPresenceChangedPayload,
  },
  'agent.location.updated': {
    version: DOMAIN_EVENT_SCHEMA_VERSION,
    payloadClass: AgentLocationUpdatedPayload,
  },
  'agent.capacity.changed': {
    version: DOMAIN_EVENT_SCHEMA_VERSION,
    payloadClass: AgentCapacityChangedPayload,
  },
  'ad.impression': {
    version: DOMAIN_EVENT_SCHEMA_VERSION,
    payloadClass: AdImpressionPayload,
  },
  'ad.click': {
    version: DOMAIN_EVENT_SCHEMA_VERSION,
    payloadClass: AdClickPayload,
  },
  'ad.conversion': {
    version: DOMAIN_EVENT_SCHEMA_VERSION,
    payloadClass: AdConversionPayload,
  },
  'job.progress': {
    version: DOMAIN_EVENT_SCHEMA_VERSION,
    payloadClass: JobProgressPayload,
  },
  'job.completed': {
    version: DOMAIN_EVENT_SCHEMA_VERSION,
    payloadClass: JobCompletedPayload,
  },
  'job.failed': {
    version: DOMAIN_EVENT_SCHEMA_VERSION,
    payloadClass: JobFailedPayload,
  },
};

export function listRegisteredDomainEventTypes(): DomainEventType[] {
  return [...DOMAIN_EVENT_TYPES];
}

export function isRegisteredDomainEventType(
  type: string,
): type is DomainEventType {
  return isDomainEventType(type) && type in DOMAIN_EVENT_REGISTRY;
}

export function getDomainEventSchemaVersion(type: DomainEventType): number {
  return DOMAIN_EVENT_REGISTRY[type].version;
}

export function assertRegisteredDomainEventType(
  type: string,
): asserts type is DomainEventType {
  if (!isRegisteredDomainEventType(type)) {
    throw new DomainEventTypeNotRegisteredError(type);
  }
}

export function validateDomainEventPayload<T extends DomainEventType>(
  type: T,
  payload: unknown,
): DomainEventPayloadMap[T] {
  assertRegisteredDomainEventType(type);
  const entry = DOMAIN_EVENT_REGISTRY[type];
  return validatePayload(entry.payloadClass, payload, type);
}

/**
 * Valide une enveloppe complète (structure + type enregistré + payload).
 * Utiliser avant enqueue (EDA-002).
 */
export function validateDomainEventEnvelope(
  envelope: unknown,
): DomainEventEnvelope {
  if (!envelope || typeof envelope !== 'object') {
    throw new DomainEventValidationError('Domain event envelope must be an object');
  }

  const raw = envelope as Record<string, unknown>;
  const type = String(raw.type ?? '').trim();
  assertRegisteredDomainEventType(type);

  const id = String(raw.id ?? '').trim();
  if (!isUuid(id)) {
    throw new DomainEventValidationError('Domain event id must be a UUID v4');
  }

  const version = Number(raw.version);
  const expectedVersion = getDomainEventSchemaVersion(type);
  if (!Number.isFinite(version) || version !== expectedVersion) {
    throw new DomainEventVersionMismatchError(type, expectedVersion, version);
  }

  const occurredAt = String(raw.occurredAt ?? '').trim();
  assertIsoDate(occurredAt);

  const payload = validateDomainEventPayload(type, raw.payload);
  const metadata = normalizeMetadata(raw.metadata);

  return {
    id,
    type,
    version,
    occurredAt,
    payload,
    ...(metadata ? { metadata } : {}),
  };
}

function normalizeMetadata(raw: unknown): DomainEventMetadata | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== 'object') {
    throw new DomainEventValidationError('metadata must be an object');
  }
  const m = raw as Record<string, unknown>;
  const metadata: DomainEventMetadata = {};
  if (m.correlationId != null) {
    metadata.correlationId = String(m.correlationId).trim();
  }
  if (m.causationId != null) {
    metadata.causationId = String(m.causationId).trim();
  }
  if (m.actorUserId != null) {
    metadata.actorUserId = String(m.actorUserId).trim();
  }
  if (m.source != null) {
    metadata.source = String(m.source).trim();
  }
  if (m.stripeFulfillment != null && typeof m.stripeFulfillment === 'object') {
    metadata.stripeFulfillment = m.stripeFulfillment as Record<string, unknown>;
  }
  if (
    m.stripeSubscriptionIntent != null &&
    typeof m.stripeSubscriptionIntent === 'object'
  ) {
    metadata.stripeSubscriptionIntent = m.stripeSubscriptionIntent as Record<
      string,
      unknown
    >;
  }
  if (m.orderContext != null && typeof m.orderContext === 'object') {
    metadata.orderContext = m.orderContext as Record<string, unknown>;
  }
  if (m.stripeConnectAccount != null && typeof m.stripeConnectAccount === 'object') {
    metadata.stripeConnectAccount = m.stripeConnectAccount as Record<
      string,
      unknown
    >;
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

/**
 * Construit une enveloppe validée prête à publier (EDA-002).
 * Rejette les types non enregistrés et les payloads invalides.
 */
export function buildValidatedDomainEvent<T extends DomainEventType>(
  draft: DomainEventDraft<T>,
): DomainEventEnvelopeFor<T> {
  assertRegisteredDomainEventType(draft.type);
  const entry = DOMAIN_EVENT_REGISTRY[draft.type];
  const version = draft.version ?? entry.version;
  if (version !== entry.version) {
    throw new DomainEventVersionMismatchError(draft.type, entry.version, version);
  }

  const payload = validateDomainEventPayload(draft.type, draft.payload);
  const envelope: DomainEventEnvelopeFor<T> = {
    id: draft.id?.trim() || randomUUID(),
    type: draft.type,
    version: entry.version,
    occurredAt: draft.occurredAt ?? new Date().toISOString(),
    payload,
    ...(draft.metadata ? { metadata: draft.metadata } : {}),
  };

  return validateDomainEventEnvelope(envelope) as DomainEventEnvelopeFor<T>;
}

/** Garde-fou : le registry couvre tous les types déclarés. */
export function assertDomainEventRegistryComplete(): void {
  for (const type of DOMAIN_EVENT_TYPES) {
    if (!(type in DOMAIN_EVENT_REGISTRY)) {
      throw new Error(`Missing registry entry for domain event type: ${type}`);
    }
  }
}

assertDomainEventRegistryComplete();
