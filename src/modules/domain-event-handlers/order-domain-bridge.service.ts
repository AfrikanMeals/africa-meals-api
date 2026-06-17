import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomainEventPublisherService } from '../../common/domain-events/domain-event-publisher.service';
import { DomainEventDraft } from '../../common/domain-events/domain-event.types';
import { DomainEventType } from '../../common/domain-events/domain-event-types';
import { isDomainEventsEnabled } from './domain-event-handlers.util';

@Injectable()
export class OrderDomainBridgeService {
  private readonly logger = new Logger(OrderDomainBridgeService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly publisher: DomainEventPublisherService,
  ) {}

  enabled(): boolean {
    return isDomainEventsEnabled(this.config);
  }

  /** Émet un événement domaine ; si désactivé, exécute le fallback legacy. */
  async emitOrLegacy<T extends DomainEventType>(
    draft: DomainEventDraft<T>,
    legacy: () => void | Promise<void>,
  ): Promise<void> {
    if (!this.enabled()) {
      await legacy();
      return;
    }
    await this.emit(draft);
  }

  async emit<T extends DomainEventType>(draft: DomainEventDraft<T>): Promise<void> {
    if (!this.enabled()) return;
    const result = await this.publisher.publish(draft);
    if (!result.ok && result.mode !== 'duplicate') {
      this.logger.warn(
        `Domain event publish skipped type=${draft.type} reason=${result.reason ?? result.mode}`,
      );
    }
  }
}
