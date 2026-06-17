import { Injectable, OnModuleInit } from '@nestjs/common';
import { DomainEventPublisherService } from '../../common/domain-events/domain-event-publisher.service';
import { DomainEventHandlersService } from './domain-event-handlers.service';

@Injectable()
export class DomainEventHandlersBootstrapService implements OnModuleInit {
  constructor(
    private readonly publisher: DomainEventPublisherService,
    private readonly handlers: DomainEventHandlersService,
  ) {}

  onModuleInit(): void {
    this.publisher.registerInProcessHandler((envelope) =>
      this.handlers.dispatch(envelope),
    );
  }
}
