import { DomainEventType } from './domain-event-types';

export class DomainEventValidationError extends Error {
  readonly code: string = 'domain_event_validation_failed';

  constructor(
    message: string,
    readonly details?: {
      type?: string;
      fieldErrors?: string[];
    },
  ) {
    super(message);
    this.name = 'DomainEventValidationError';
  }
}

export class DomainEventTypeNotRegisteredError extends DomainEventValidationError {
  readonly code = 'domain_event_type_not_registered';

  constructor(type: string) {
    super(`Domain event type is not registered: ${type}`, { type });
    this.name = 'DomainEventTypeNotRegisteredError';
  }
}

export class DomainEventVersionMismatchError extends DomainEventValidationError {
  readonly code = 'domain_event_version_mismatch';

  constructor(
    type: DomainEventType,
    expected: number,
    received: number,
  ) {
    super(
      `Domain event version mismatch for ${type}: expected ${expected}, received ${received}`,
      { type },
    );
    this.name = 'DomainEventVersionMismatchError';
  }
}
