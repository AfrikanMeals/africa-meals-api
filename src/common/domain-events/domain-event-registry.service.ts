import { Injectable } from '@nestjs/common';
import {
  buildValidatedDomainEvent,
  getDomainEventSchemaVersion,
  isRegisteredDomainEventType,
  listRegisteredDomainEventTypes,
  validateDomainEventEnvelope,
  validateDomainEventPayload,
} from './domain-event.registry';
import { DomainEventType } from './domain-event-types';
import {
  DomainEventDraft,
  DomainEventEnvelope,
  DomainEventEnvelopeFor,
} from './domain-event.types';
import { DomainEventPayloadMap } from './payloads';

/**
 * Service Nest injectable pour valider et construire des événements domaine.
 * Le publisher (EDA-002) doit appeler `buildForPublish` avant enqueue.
 */
@Injectable()
export class DomainEventRegistryService {
  listTypes(): DomainEventType[] {
    return listRegisteredDomainEventTypes();
  }

  isRegistered(type: string): type is DomainEventType {
    return isRegisteredDomainEventType(type);
  }

  getSchemaVersion(type: DomainEventType): number {
    return getDomainEventSchemaVersion(type);
  }

  validatePayload<T extends DomainEventType>(
    type: T,
    payload: unknown,
  ): DomainEventPayloadMap[T] {
    return validateDomainEventPayload(type, payload);
  }

  validateEnvelope(envelope: unknown): DomainEventEnvelope {
    return validateDomainEventEnvelope(envelope);
  }

  buildForPublish<T extends DomainEventType>(
    draft: DomainEventDraft<T>,
  ): DomainEventEnvelopeFor<T> {
    return buildValidatedDomainEvent(draft);
  }
}
