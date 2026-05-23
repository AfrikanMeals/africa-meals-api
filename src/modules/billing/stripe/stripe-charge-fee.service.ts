import {
  allocateStripeProcessingFeeShareCents,
  effectiveStripeProcessingFeeCents,
} from '@modules/billing/stripe/stripe-processing-fee.util';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { StripeProcessedCheckoutModel } from '@schemas/stripe-processed-checkout.schema';
import { Model } from 'mongoose';
import Stripe = require('stripe');

type StripeClient = InstanceType<typeof Stripe>;

export type ChargeFeeSnapshot = {
  amountCents: number;
  feeCents: number;
};

/**
 * Frais Stripe processing (balance_transaction) partagés entre transferts Connect et remboursements.
 */
@Injectable()
export class StripeChargeFeeService {
  private readonly logger = new Logger(StripeChargeFeeService.name);
  private readonly chargeFeeCache = new Map<
    string,
    Promise<ChargeFeeSnapshot | null>
  >();

  constructor(
    private readonly config: ConfigService,
    @InjectModel(StripeProcessedCheckoutModel.name)
    private readonly processedCheckoutModel: Model<StripeProcessedCheckoutModel>,
  ) {}

  private stripe(): StripeClient {
    const key = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
    if (!key) {
      throw new Error('stripe_not_configured');
    }
    return new Stripe(key);
  }

  async paymentTotalCentsForParent(
    stripeParentPaymentId: string,
    fallbackCents: number,
  ): Promise<number> {
    const parentId = stripeParentPaymentId.trim();
    if (!parentId) {
      return Math.max(0, Math.round(fallbackCents));
    }
    const doc = await this.processedCheckoutModel
      .findOne({ sessionId: parentId })
      .select('amountTotalCents')
      .lean()
      .exec();
    const total = Number(doc?.amountTotalCents ?? 0);
    if (total > 0) return Math.round(total);
    return Math.max(0, Math.round(fallbackCents));
  }

  private async loadChargeFeeSnapshot(
    chargeId: string,
  ): Promise<ChargeFeeSnapshot | null> {
    const raw = chargeId.trim();
    if (!raw.startsWith('ch_')) return null;

    const charge = await this.stripe().charges.retrieve(raw, {
      expand: ['balance_transaction'],
    });
    const amountCents = Math.max(0, Math.round(Number(charge.amount ?? 0)));
    const bt = charge.balance_transaction;
    if (!bt || typeof bt === 'string' || typeof bt !== 'object') {
      return { amountCents, feeCents: 0 };
    }
    const feeCents = Math.max(
      0,
      Math.round(Number((bt as { fee?: number }).fee ?? 0)),
    );
    return { amountCents, feeCents };
  }

  chargeFeeSnapshot(chargeId: string): Promise<ChargeFeeSnapshot | null> {
    const key = chargeId.trim();
    const inCache = this.chargeFeeCache.get(key);
    if (inCache) return inCache;
    const p = this.loadChargeFeeSnapshot(key).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Unable to load charge fees for ${key}: ${msg}`);
      return null;
    });
    this.chargeFeeCache.set(key, p);
    return p;
  }

  async totalProcessingFeeCents(args: {
    chargeId: string;
    paymentAmountCents: number;
  }): Promise<number> {
    const paymentAmount = Math.max(0, Math.round(args.paymentAmountCents));
    if (paymentAmount < 1) return 0;

    const snap = await this.chargeFeeSnapshot(args.chargeId);
    const chargeAmount = snap?.amountCents ?? paymentAmount;
    const actualFee = snap?.feeCents ?? 0;
    return effectiveStripeProcessingFeeCents(actualFee, chargeAmount);
  }

  allocateProcessingFeeShareCents(args: {
    totalStripeFeeCents: number;
    paymentAmountCents: number;
    sliceAmountCents: number;
    maxDeductibleCents: number;
  }): number {
    return allocateStripeProcessingFeeShareCents({
      totalStripeFeeCents: args.totalStripeFeeCents,
      paymentAmountCents: args.paymentAmountCents,
      sliceAmountCents: args.sliceAmountCents,
      maxDeductibleCents: args.maxDeductibleCents,
    });
  }

  /** Résout l’id charge `ch_…` liée à un `pi_…` ou `cs_…`. */
  async resolveChargeId(stripeParentPaymentId: string): Promise<string | null> {
    const id = stripeParentPaymentId.trim();
    if (!id) return null;
    const stripe = this.stripe();

    const chargeFromPi = async (piId: string): Promise<string | null> => {
      const pi = await stripe.paymentIntents.retrieve(piId, {
        expand: ['latest_charge'],
      });
      const ch = pi.latest_charge;
      if (typeof ch === 'string' && ch.startsWith('ch_')) return ch;
      if (ch && typeof ch === 'object' && 'id' in ch) {
        const cid = String((ch as { id: string }).id);
        return cid.startsWith('ch_') ? cid : null;
      }
      return null;
    };

    if (id.startsWith('pi_')) {
      return chargeFromPi(id);
    }
    if (id.startsWith('cs_')) {
      const session = await stripe.checkout.sessions.retrieve(id);
      const pi = session.payment_intent;
      if (typeof pi === 'string' && pi.startsWith('pi_')) {
        return chargeFromPi(pi);
      }
      if (pi && typeof pi === 'object' && 'id' in pi) {
        return chargeFromPi(String((pi as { id: string }).id));
      }
    }
    return null;
  }
}
