import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe = require('stripe');

type StripeClient = InstanceType<typeof Stripe>;

@Injectable()
export class StripeRefundService {
  private readonly logger = new Logger(StripeRefundService.name);

  constructor(private readonly config: ConfigService) {}

  private stripe(): StripeClient {
    const key = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY_missing');
    }
    return new Stripe(key);
  }

  async resolvePaymentIntentId(parentId: string): Promise<string | null> {
    const id = parentId.trim();
    if (!id) return null;
    if (id.startsWith('pi_')) return id;
    const stripe = this.stripe();
    if (id.startsWith('cs_')) {
      const session = await stripe.checkout.sessions.retrieve(id);
      const pi = session.payment_intent;
      if (typeof pi === 'string') return pi;
      if (pi && typeof pi === 'object' && 'id' in pi) {
        return String((pi as { id: string }).id);
      }
      return null;
    }
    this.logger.warn(`Unsupported stripe parent id prefix: ${id.slice(0, 8)}`);
    return null;
  }

  async createRefundForOrder(args: {
    stripeParentPaymentId: string;
    amountCents: number;
    orderId: string;
    platformRefundFeeCents?: number;
    stripeProcessingFeeCents?: number;
    refundGrossCents?: number;
  }): Promise<string> {
    const piId = await this.resolvePaymentIntentId(args.stripeParentPaymentId);
    if (!piId) {
      throw new Error('stripe_payment_intent_unresolved');
    }
    const amount = Math.max(1, Math.round(args.amountCents));
    const stripe = this.stripe();
    const refund = await stripe.refunds.create({
      payment_intent: piId,
      amount,
      reason: 'requested_by_customer',
      metadata: {
        orderId: args.orderId,
        platform: 'wise-eat',
        ...(args.refundGrossCents != null
          ? { refundGrossCents: String(args.refundGrossCents) }
          : {}),
        ...(args.platformRefundFeeCents != null
          ? { platformRefundFeeCents: String(args.platformRefundFeeCents) }
          : {}),
        ...(args.stripeProcessingFeeCents != null
          ? {
              stripeProcessingFeeOnCustomerCents: String(
                args.stripeProcessingFeeCents,
              ),
            }
          : {}),
      },
    });
    if (!refund.id) {
      throw new Error('stripe_refund_missing_id');
    }
    return refund.id;
  }
}
