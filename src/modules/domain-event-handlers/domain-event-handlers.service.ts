import { Injectable, Logger } from '@nestjs/common';
import { DomainEventPublisherService } from '../../common/domain-events/domain-event-publisher.service';
import {
  DomainEventDraft,
  DomainEventEnvelope,
} from '../../common/domain-events/domain-event.types';
import { DomainEventType } from '../../common/domain-events/domain-event-types';
import { AdDomainEventHandler } from './handlers/ad-domain-event.handler';
import { AgentDomainEventHandler } from './handlers/agent-domain-event.handler';
import { JobDomainEventHandler } from './handlers/job-domain-event.handler';
import { OrderDomainEventHandler } from './handlers/order-domain-event.handler';
import { PaymentDomainEventHandler } from './handlers/payment-domain-event.handler';
import { RefundDomainEventHandler } from './handlers/refund-domain-event.handler';

import { SubscriptionDomainEventHandler } from './handlers/subscription-domain-event.handler';

@Injectable()
export class DomainEventHandlersService {
  private readonly logger = new Logger(DomainEventHandlersService.name);

  constructor(
    private readonly publisher: DomainEventPublisherService,
    private readonly orders: OrderDomainEventHandler,
    private readonly payments: PaymentDomainEventHandler,
    private readonly agents: AgentDomainEventHandler,
    private readonly ads: AdDomainEventHandler,
    private readonly refunds: RefundDomainEventHandler,
    private readonly jobs: JobDomainEventHandler,
    private readonly subscriptions: SubscriptionDomainEventHandler,
  ) {}

  /** Publie sur le bus ; les handlers in-process sont invoqués par le publisher. */
  async emit<T extends DomainEventType>(
    draft: DomainEventDraft<T>,
  ): Promise<void> {
    const result = await this.publisher.publish(draft);
    if (!result.ok && result.mode !== 'duplicate') {
      this.logger.warn(
        `Domain event publish skipped type=${draft.type} reason=${result.reason ?? result.mode}`,
      );
    }
  }

  /** Handlers in-process — appelé par DomainEventPublisherService après claim idempotence. */
  async dispatch(envelope: DomainEventEnvelope): Promise<void> {
    const started = performance.now();
    try {
      const type = envelope.type;
      if (type.startsWith('order.')) {
        await this.orders.handle(envelope);
      } else if (
        type.startsWith('payment.') ||
        type === 'subscription.checkout.completed'
      ) {
        await this.payments.handle(envelope);
      } else if (type.startsWith('agent.')) {
        await this.agents.handle(envelope);
      } else if (type.startsWith('ad.')) {
        await this.ads.handle(envelope);
      } else if (type.startsWith('job.')) {
        await this.jobs.handle(envelope);
      } else if (type.startsWith('subscription.')) {
        await this.subscriptions.handle(envelope);
      }
      if (type === 'order.cancelled') {
        await this.refunds.handle(envelope);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Domain handler failed type=${envelope.type} id=${envelope.id}: ${msg}`,
      );
    } finally {
      const ms = Math.round(performance.now() - started);
      this.logger.debug(
        `Domain handler done type=${envelope.type} id=${envelope.id} latencyMs=${ms}`,
      );
    }
  }
}
