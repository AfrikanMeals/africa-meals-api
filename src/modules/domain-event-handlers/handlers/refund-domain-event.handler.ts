import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { DomainEventEnvelope } from '../../../common/domain-events/domain-event.types';
import { OrderCancelledPayload } from '../../../common/domain-events/payloads/order-domain-event.payloads';
import { RefundProcessingService } from '@modules/refunds/refund-processing.service';

@Injectable()
export class RefundDomainEventHandler {
  private readonly logger = new Logger(RefundDomainEventHandler.name);

  constructor(
    @Inject(forwardRef(() => RefundProcessingService))
    private readonly refunds: RefundProcessingService,
  ) {}

  async handle(envelope: DomainEventEnvelope): Promise<void> {
    if (envelope.type !== 'order.cancelled') return;
    const payload = envelope.payload as OrderCancelledPayload;
    try {
      await this.refunds.enqueueRefundForCancelledOrder(payload.orderId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Refund enqueue failed order=${payload.orderId}: ${msg}`,
      );
    }
  }
}
