import {
  allocateStripeProcessingFeeShareCents,
  effectiveStripeProcessingFeeCents,
} from '@modules/billing/stripe/stripe-processing-fee.util';
import {
  convertChargeMinorToSettlementMinor,
  normalizeFxCurrency,
  resolveChargeSettlementExchangeRate,
} from '@modules/billing/stripe/stripe-charge-settlement-fx.util';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { StripeProcessedCheckoutModel } from '@schemas/stripe-processed-checkout.schema';
import { Model } from 'mongoose';
import Stripe = require('stripe');

type StripeClient = InstanceType<typeof Stripe>;

export type ChargeFeeSnapshot = {
  /** Montant charge (devise client, ex. XAF). */
  amountCents: number;
  /** Frais Stripe (devise de règlement plateforme, ex. CAD). */
  feeCents: number;
  /**
   * Devise pour `transfers.create` = devise du balance_transaction
   * (peut différer de la devise charge, ex. XAF → CAD).
   */
  currency: string;
  chargeCurrency: string;
  settlementAmountCents: number;
  exchangeRate: number;
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
    const chargeCurrency = normalizeFxCurrency(charge.currency ?? 'cad');
    const bt = charge.balance_transaction;
    if (!bt || typeof bt === 'string' || typeof bt !== 'object') {
      return {
        amountCents,
        feeCents: 0,
        currency: chargeCurrency,
        chargeCurrency,
        settlementAmountCents: amountCents,
        exchangeRate: 1,
      };
    }
    const btObj = bt as {
      fee?: number;
      amount?: number;
      currency?: string;
      exchange_rate?: number | null;
    };
    const settlementCurrency = normalizeFxCurrency(
      btObj.currency ?? chargeCurrency,
    );
    const feeCents = Math.max(0, Math.round(Number(btObj.fee ?? 0)));
    const settlementAmountCents = Math.max(
      0,
      Math.round(Number(btObj.amount ?? 0)),
    );
    const exchangeRate = resolveChargeSettlementExchangeRate({
      chargeCurrency,
      settlementCurrency,
      exchangeRate: btObj.exchange_rate,
      chargeAmountMinor: amountCents,
      settlementAmountMinor: settlementAmountCents,
    });

    return {
      amountCents,
      feeCents,
      currency: settlementCurrency,
      chargeCurrency,
      settlementAmountCents:
        settlementAmountCents > 0
          ? settlementAmountCents
          : convertChargeMinorToSettlementMinor(amountCents, { exchangeRate }),
      exchangeRate,
    };
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

  /** Convertit une tranche (devise charge) vers la devise de transfer Connect. */
  toTransferMinorUnits(
    chargeMinor: number,
    snap: ChargeFeeSnapshot | null | undefined,
  ): number {
    if (!snap) return Math.max(0, Math.round(chargeMinor));
    return convertChargeMinorToSettlementMinor(chargeMinor, {
      exchangeRate: snap.exchangeRate,
    });
  }

  async totalProcessingFeeCents(args: {
    chargeId: string;
    paymentAmountCents: number;
  }): Promise<number> {
    const paymentAmount = Math.max(0, Math.round(args.paymentAmountCents));
    if (paymentAmount < 1) return 0;

    const snap = await this.chargeFeeSnapshot(args.chargeId);
    const chargeAmount = snap?.amountCents ?? paymentAmount;
    const settlementCap =
      snap?.settlementAmountCents && snap.settlementAmountCents > 0
        ? snap.settlementAmountCents
        : this.toTransferMinorUnits(chargeAmount, snap);
    const actualFee = snap?.feeCents ?? 0;
    // Les frais BT sont déjà en devise de règlement : plafonner sur le montant settlement.
    if (actualFee > 0) {
      return Math.min(settlementCap, Math.round(actualFee));
    }
    return effectiveStripeProcessingFeeCents(null, settlementCap);
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

  /** Montant encore transférable depuis une charge (source_transaction), devise settlement. */
  async remainingTransferableCents(chargeId: string): Promise<number> {
    const snap = await this.chargeFeeSnapshot(chargeId);
    if (!snap) return 0;
    const capacity =
      snap.settlementAmountCents > 0
        ? snap.settlementAmountCents
        : this.toTransferMinorUnits(snap.amountCents, snap);
    if (capacity < 1) return 0;
    const stripe = this.stripe();
    let transferred = 0;
    let startingAfter: string | undefined;
    for (let page = 0; page < 20; page++) {
      const batch = await stripe.transfers.list({
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const tr of batch.data) {
        if (tr.source_transaction === chargeId) {
          transferred += Math.max(0, Math.round(Number(tr.amount ?? 0)));
        }
      }
      if (!batch.has_more || !batch.data.length) break;
      startingAfter = batch.data[batch.data.length - 1]?.id;
    }
    return Math.max(0, capacity - transferred);
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
    if (id.startsWith('ch_')) return id;
    return null;
  }
}
