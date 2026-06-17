import { DomainEventType } from './domain-event-types';

export type DomainEventPublishMode =
  | 'queued'
  | 'mqtt'
  | 'skipped'
  | 'duplicate';

export type DomainEventPublishResult = {
  ok: boolean;
  eventId: string;
  type: DomainEventType;
  mode: DomainEventPublishMode;
  reason?: string;
};
