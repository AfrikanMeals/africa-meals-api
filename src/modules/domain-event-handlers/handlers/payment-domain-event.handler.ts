import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { DomainEventEnvelope } from '../../../common/domain-events/domain-event.types';
import {
  PaymentCheckoutCompletedPayload,
  PaymentConnectAccountUpdatedPayload,
  PaymentIntentSucceededPayload,
  SubscriptionCheckoutCompletedPayload,
} from '../../../common/domain-events/payloads/payment-domain-event.payloads';
import { StripeGroupedCheckoutService } from '@modules/billing/stripe/stripe-grouped-checkout.service';
import { StripeConnectService } from '@modules/billing/stripe/stripe-connect.service';
import { SubscriptionsStripeCheckoutService } from '@modules/subscriptions/subscriptions-stripe-checkout.service';
import { CheckoutSessionSseService } from '@modules/sse-stream/checkout-session-sse.service';

type StripeFulfillmentMeta = {
  uid: string;
  storesCsv: string;
  shipB64?: string;
  metadata?: Record<string, string | undefined | null>;
  amountTotalCents?: number;
  currency?: string;
  stripeEventKind: 'checkout_session' | 'payment_intent';
  stripePaymentId: string;
};

@Injectable()
export class PaymentDomainEventHandler {
  private readonly logger = new Logger(PaymentDomainEventHandler.name);

  constructor(
    @Inject(forwardRef(() => StripeGroupedCheckoutService))
    private readonly stripeCheckout: StripeGroupedCheckoutService,
    private readonly subscriptionCheckout: SubscriptionsStripeCheckoutService,
    private readonly checkoutSse: CheckoutSessionSseService,
    private readonly stripeConnect: StripeConnectService,
  ) {}

  async handle(envelope: DomainEventEnvelope): Promise<void> {
    switch (envelope.type) {
      case 'payment.checkout.completed':
        await this.onCheckoutCompleted(
          envelope.payload as PaymentCheckoutCompletedPayload,
          envelope.metadata,
        );
        break;
      case 'payment.intent.succeeded':
        await this.onIntentSucceeded(
          envelope.payload as PaymentIntentSucceededPayload,
          envelope.metadata,
        );
        break;
      case 'subscription.checkout.completed':
        await this.onSubscriptionCheckout(
          envelope.payload as SubscriptionCheckoutCompletedPayload,
        );
        break;
      case 'payment.connect.account.updated':
        await this.onConnectAccountUpdated(
          envelope.payload as PaymentConnectAccountUpdatedPayload,
          envelope.metadata,
        );
        break;
      default:
        break;
    }
  }

  private async onConnectAccountUpdated(
    _payload: PaymentConnectAccountUpdatedPayload,
    metadata?: DomainEventEnvelope['metadata'],
  ): Promise<void> {
    const account = metadata?.stripeConnectAccount as
      | {
          id: string;
          charges_enabled?: boolean;
          payouts_enabled?: boolean;
          details_submitted?: boolean;
          requirements?: {
            disabled_reason?: string | null;
            currently_due?: string[] | null;
            past_due?: string[] | null;
          } | null;
        }
      | undefined;
    if (!account?.id) {
      this.logger.warn('payment.connect.account.updated missing account object');
      return;
    }
    await this.stripeConnect.handleAccountUpdated(account);
  }

  private async onCheckoutCompleted(
    payload: PaymentCheckoutCompletedPayload,
    metadata?: DomainEventEnvelope['metadata'],
  ): Promise<void> {
    if (payload.kind === 'vendor_subscription') return;
    const fulfillment = metadata?.stripeFulfillment as
      | StripeFulfillmentMeta
      | undefined;
    if (!fulfillment?.uid || !fulfillment.storesCsv) {
      this.logger.warn(
        `payment.checkout.completed missing fulfillment context session=${payload.sessionId}`,
      );
      return;
    }
    const result = await this.stripeCheckout.fulfillFromDomainEvent({
      stripePaymentId: fulfillment.stripePaymentId,
      uid: fulfillment.uid,
      storesCsv: fulfillment.storesCsv,
      shipB64: fulfillment.shipB64,
      metadata: fulfillment.metadata ?? {},
      amountTotalCents: fulfillment.amountTotalCents,
      currency: fulfillment.currency,
      stripeEventKind: fulfillment.stripeEventKind,
    });
    this.checkoutSse.emit(payload.sessionId, {
      type: 'checkout_completed',
      sessionId: payload.sessionId,
      orderIds: result.orderIds,
      complete: result.complete,
    });
  }

  private async onIntentSucceeded(
    payload: PaymentIntentSucceededPayload,
    metadata?: DomainEventEnvelope['metadata'],
  ): Promise<void> {
    const subscriptionIntent = metadata?.stripeSubscriptionIntent as
      | {
          id: string;
          status?: string | null;
          metadata?: Record<string, string | null | undefined> | null;
          amount?: number | null;
          amount_received?: number | null;
          currency?: string | null;
        }
      | undefined;
    if (subscriptionIntent?.id) {
      await this.subscriptionCheckout.fulfillFromPaymentIntentObject(
        subscriptionIntent,
      );
      return;
    }

    const fulfillment = metadata?.stripeFulfillment as
      | StripeFulfillmentMeta
      | undefined;
    if (!fulfillment?.uid || !fulfillment.storesCsv) return;
    await this.stripeCheckout.fulfillFromDomainEvent({
      stripePaymentId: fulfillment.stripePaymentId,
      uid: fulfillment.uid,
      storesCsv: fulfillment.storesCsv,
      shipB64: fulfillment.shipB64,
      metadata: fulfillment.metadata ?? {},
      amountTotalCents: payload.amountCents,
      currency: payload.currency,
      stripeEventKind: fulfillment.stripeEventKind,
    });
  }

  private async onSubscriptionCheckout(
    payload: SubscriptionCheckoutCompletedPayload,
  ): Promise<void> {
    await this.subscriptionCheckout.confirmCheckoutForUserBySessionId(
      payload.userId,
      payload.sessionId,
    );
    this.checkoutSse.emit(payload.sessionId, {
      type: 'subscription_completed',
      sessionId: payload.sessionId,
    });
  }
}
