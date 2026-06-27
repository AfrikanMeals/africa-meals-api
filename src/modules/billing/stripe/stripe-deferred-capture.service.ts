import { StripeConnectTransferService } from './stripe-connect-transfer.service';
import { StripeChargeFeeService } from './stripe-charge-fee.service';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { OrderModel } from '@schemas/order.schema';
import {
  StripePerStoreBreakdownRow,
  StripeProcessedCheckoutModel,
} from '@schemas/stripe-processed-checkout.schema';
import { Model } from 'mongoose';
import Stripe = require('stripe');

type StripeClient = InstanceType<typeof Stripe>;

export const STRIPE_DEFERRED_CAPTURE_METADATA = 'defCap';

@Injectable()
export class StripeDeferredCaptureService {
  private readonly logger = new Logger(StripeDeferredCaptureService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly stripeFees: StripeChargeFeeService,
    private readonly transfers: StripeConnectTransferService,
    @InjectModel(OrderModel.name)
    private readonly orderModel: Model<OrderModel>,
    @InjectModel(StripeProcessedCheckoutModel.name)
    private readonly processedModel: Model<StripeProcessedCheckoutModel>,
  ) {}

  isEnabled(): boolean {
    const raw = this.config.get<string>('STRIPE_DEFERRED_CAPTURE');
    return raw === '1' || raw === 'true';
  }

  /** Capture différée : checkout mono-boutique Stripe uniquement (panier groupé multi-restaurant = capture immédiate). */
  shouldDeferForStripeStoreCount(stripeStoreCount: number): boolean {
    return this.isEnabled() && stripeStoreCount === 1;
  }

  captureMethodForStripeStoreCount(
    stripeStoreCount: number,
  ): 'automatic' | 'manual' {
    return this.shouldDeferForStripeStoreCount(stripeStoreCount)
      ? 'manual'
      : 'automatic';
  }

  metadataFlag(defer: boolean): Record<string, string> {
    return defer ? { [STRIPE_DEFERRED_CAPTURE_METADATA]: '1' } : {};
  }

  isDeferredFromMetadata(
    metadata: Record<string, string | undefined | null>,
  ): boolean {
    return (
      String(metadata?.[STRIPE_DEFERRED_CAPTURE_METADATA] ?? '').trim() ===
      '1'
    );
  }

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
    }
    return null;
  }

  /** Après fulfillment : commandes autorisées, transferts Connect reportés. */
  async markOrdersAuthorized(stripeParentPaymentId: string): Promise<void> {
    const pi = stripeParentPaymentId.trim();
    if (!pi) return;
    await this.orderModel
      .updateMany(
        { stripeParentPaymentId: pi },
        {
          $set: {
            stripeCaptureStatus: 'authorized',
          },
        },
      )
      .exec();
  }

  /**
   * Capture le PaymentIntent à la mise en « prête » + transferts Connect (idempotent).
   */
  async captureOnOrderReady(orderId: string): Promise<void> {
    const oid = orderId.trim();
    const order = await this.orderModel
      .findById(oid)
      .select(
        'stripeParentPaymentId stripeCaptureStatus stripeTransferId store stripeChargedGoodsCents stripeChargedShipCents',
      )
      .lean()
      .exec();
    if (!order) return;

    const parentId = String(order.stripeParentPaymentId ?? '').trim();
    if (!parentId) return;
    if (String(order.stripeCaptureStatus ?? '') !== 'authorized') {
      return;
    }

    const piId = await this.resolvePaymentIntentId(parentId);
    if (!piId) {
      this.logger.warn(`deferred capture: PI unresolved order=${oid}`);
      return;
    }

    const stripe = this.stripe();
    const pi = await stripe.paymentIntents.retrieve(piId);
    if (pi.status === 'requires_capture') {
      await stripe.paymentIntents.capture(piId);
      this.logger.log(`deferred capture: captured PI ${piId} order=${oid}`);
    } else if (pi.status !== 'succeeded') {
      this.logger.warn(
        `deferred capture: skip PI ${piId} status=${pi.status} order=${oid}`,
      );
      return;
    }

    const capturedAt = new Date();
    await this.orderModel
      .updateMany(
        {
          stripeParentPaymentId: parentId,
          stripeCaptureStatus: 'authorized',
        },
        {
          $set: {
            stripeCaptureStatus: 'captured',
            stripeCapturedAt: capturedAt,
          },
        },
      )
      .exec();

    await this.runPendingTransfersForPayment(parentId, pi.amount_received ?? pi.amount);
  }

  /**
   * Annulation avant capture : libère l’autorisation (pas de remboursement).
   */
  async cancelAuthorizationIfUncaptured(
    stripeParentPaymentId: string,
  ): Promise<'cancelled' | 'captured' | 'skipped'> {
    const parentId = stripeParentPaymentId.trim();
    if (!parentId) return 'skipped';

    const piId = await this.resolvePaymentIntentId(parentId);
    if (!piId) return 'skipped';

    const stripe = this.stripe();
    const pi = await stripe.paymentIntents.retrieve(piId);
    if (pi.status === 'requires_capture') {
      await stripe.paymentIntents.cancel(piId);
      await this.orderModel
        .updateMany(
          { stripeParentPaymentId: parentId },
          {
            $set: {
              stripeCaptureStatus: 'cancelled',
            },
          },
        )
        .exec();
      this.logger.log(`deferred capture: cancelled authorization PI ${piId}`);
      return 'cancelled';
    }
    if (pi.status === 'succeeded') {
      return 'captured';
    }
    return 'skipped';
  }

  private async runPendingTransfersForPayment(
    stripeParentPaymentId: string,
    paymentTotalCents?: number | null,
  ): Promise<void> {
    const parentId = stripeParentPaymentId.trim();
    const doc = await this.processedModel
      .findOne({
        $or: [{ sessionId: parentId }, { paymentIntentId: parentId }],
      })
      .lean()
      .exec();

    const rows = (doc?.perStoreBreakdown ?? []) as StripePerStoreBreakdownRow[];
    const payoutGross = rows.reduce(
      (sum, r) =>
        sum + Math.max(0, r.goodsCents ?? 0) + Math.max(0, r.shipCents ?? 0),
      0,
    );

    const orders = await this.orderModel
      .find({
        stripeParentPaymentId: parentId,
        stripeTransferId: { $exists: false },
      })
      .select(
        '_id store stripeChargedGoodsCents stripeChargedShipCents stripeTransferId',
      )
      .lean()
      .exec();

    for (const o of orders) {
      const orderId = String(o._id);
      const storeId = String(o.store ?? '');
      const goodsCents = Math.max(
        0,
        Math.round(Number(o.stripeChargedGoodsCents ?? 0)),
      );
      const shipCents = Math.max(
        0,
        Math.round(Number(o.stripeChargedShipCents ?? 0)),
      );
      try {
        await this.transfers.transferForPaidOrder({
          orderId,
          storeId,
          goodsCents,
          shipCents,
          stripeParentPaymentId: parentId,
          paymentTotalCents: paymentTotalCents ?? undefined,
          totalPayoutGrossCents: payoutGross > 0 ? payoutGross : undefined,
        });
      } catch (err) {
        this.logger.error(
          `deferred capture transfer failed order=${orderId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
}
