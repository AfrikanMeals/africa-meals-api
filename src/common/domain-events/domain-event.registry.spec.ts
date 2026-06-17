import {
  buildValidatedDomainEvent,
  DOMAIN_EVENT_REGISTRY,
  listRegisteredDomainEventTypes,
  validateDomainEventEnvelope,
} from './domain-event.registry';
import {
  DomainEventTypeNotRegisteredError,
  DomainEventValidationError,
} from './domain-event.errors';
import { DOMAIN_EVENT_TYPES } from './domain-event-types';

describe('domain-event.registry', () => {
  it('registers every declared domain event type', () => {
    expect(listRegisteredDomainEventTypes()).toEqual([...DOMAIN_EVENT_TYPES]);
    for (const type of DOMAIN_EVENT_TYPES) {
      expect(DOMAIN_EVENT_REGISTRY[type].version).toBe(1);
      expect(DOMAIN_EVENT_REGISTRY[type].payloadClass).toBeDefined();
    }
  });

  it('builds a validated order.paid envelope', () => {
    const envelope = buildValidatedDomainEvent({
      type: 'order.paid',
      payload: {
        orderId: '507f1f77bcf86cd799439011',
        storeId: '507f1f77bcf86cd799439012',
        customerUserId: '507f1f77bcf86cd799439013',
        amountCents: 2499,
        currency: 'cad',
      },
      metadata: { source: 'test' },
    });

    expect(envelope.type).toBe('order.paid');
    expect(envelope.version).toBe(1);
    expect(envelope.payload.currency).toBe('cad');
    expect(validateDomainEventEnvelope(envelope)).toEqual(envelope);
  });

  it('rejects unregistered event types', () => {
    expect(() =>
      buildValidatedDomainEvent({
        type: 'order.unknown' as 'order.paid',
        payload: {} as never,
      }),
    ).toThrow(DomainEventTypeNotRegisteredError);
  });

  it('rejects invalid payloads before publish', () => {
    expect(() =>
      buildValidatedDomainEvent({
        type: 'order.created',
        payload: {
          orderId: 'not-a-mongo-id',
          storeId: '507f1f77bcf86cd799439012',
          customerUserId: '507f1f77bcf86cd799439013',
          status: 'created',
        },
      }),
    ).toThrow(DomainEventValidationError);
  });

  it('rejects envelope with schema version mismatch', () => {
    const envelope = buildValidatedDomainEvent({
      type: 'order.delivered',
      payload: { orderId: '507f1f77bcf86cd799439011' },
    });

    expect(() =>
      validateDomainEventEnvelope({ ...envelope, version: 99 }),
    ).toThrow(DomainEventValidationError);
  });
});
