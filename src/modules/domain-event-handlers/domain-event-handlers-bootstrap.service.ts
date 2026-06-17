import { Injectable } from '@nestjs/common';
import { DomainEventPublisherService } from '../../common/domain-events/domain-event-publisher.service';
import { DomainEventHandlersService } from './domain-event-handlers.service';

/** Enregistre le handler avant `onModuleInit` du publisher (évite course worker / handler null). */
@Injectable()
export class DomainEventHandlersBootstrapService {
  constructor(
    publisher: DomainEventPublisherService,
    handlers: DomainEventHandlersService,
  ) {
    publisher.registerInProcessHandler((envelope) =>
      handlers.dispatch(envelope),
    );
  }
}
