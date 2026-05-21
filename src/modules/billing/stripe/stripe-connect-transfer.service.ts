import { isStripeConnectOnboardingCompleteUser } from '@modules/billing/stripe/stripe-connect-visibility';
import { PlatformFeesService } from '@modules/platform-fees/platform-fees.service';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { OrderModel } from '@schemas/order.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import Stripe = require('stripe');

type StripeClient = InstanceType<typeof Stripe>;
type ChargeFeeSnapshot = {
  amountCents: number;
  feeCents: number;
};

export type StoreTransferResult = {
  transferred: boolean;
  transferId?: string;
  transferCents: number;
  platformFeeCents: number;
  stripeProcessingFeeCents: number;
  grossCents: number;
  skippedReason?: string;
};

@Injectable()
export class StripeConnectTransferService {
  private readonly logger = new Logger(StripeConnectTransferService.name);
  private readonly chargeFeeCache = new Map<
    string,
    Promise<ChargeFeeSnapshot | null>
  >();

  constructor(
    private readonly config: ConfigService,
    private readonly platformFees: PlatformFeesService,
    @InjectModel(OrderModel.name)
    private readonly orderModel: Model<OrderModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
  ) {}

  private transfersEnabled(): boolean {
    const raw = this.config.get<string>('STRIPE_CONNECT_TRANSFERS_ENABLED');
    if (raw === '0' || raw === 'false') return false;
    return true;
  }

  private stripe(): StripeClient {
    const key = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
    if (!key) {
      throw new BadRequestException('stripe_not_configured');
    }
    return new Stripe(key);
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

  private chargeFeeSnapshot(
    chargeId: string,
  ): Promise<ChargeFeeSnapshot | null> {
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

  private async estimateStripeFeeShareCents(args: {
    chargeId: string;
    orderGrossCents: number;
    transferBeforeStripeFeesCents: number;
  }): Promise<number> {
    const orderGross = Math.max(0, Math.round(args.orderGrossCents));
    if (orderGross < 1) return 0;

    const transferGross = Math.max(
      0,
      Math.round(args.transferBeforeStripeFeesCents),
    );
    if (transferGross < 1) return 0;

    const snap = await this.chargeFeeSnapshot(args.chargeId);
    if (!snap || snap.feeCents < 1 || snap.amountCents < 1) return 0;

    const proportional = Math.round((snap.feeCents * orderGross) / snap.amountCents);
    return Math.max(0, Math.min(proportional, transferGross));
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

  private async ownerConnectAccountId(
    storeId: string,
  ): Promise<{ accountId: string | null; ownerReady: boolean }> {
    if (!Types.ObjectId.isValid(storeId)) {
      return { accountId: null, ownerReady: false };
    }
    const store = await this.storeModel
      .findById(storeId)
      .select('owner')
      .lean()
      .exec();
    if (!store?.owner) {
      return { accountId: null, ownerReady: false };
    }
    const owner = await this.userModel
      .findById(String(store.owner))
      .select(
        'stripeConnectAccountId stripeConnectChargesEnabled stripeConnectPayoutsEnabled stripeConnectDetailsSubmitted stripeConnectDisabledReason stripeConnectRequirementsDue stripeConnectRequirementsPastDue',
      )
      .lean()
      .exec();
    const accountId = owner?.stripeConnectAccountId?.trim() || null;
    const ownerReady = isStripeConnectOnboardingCompleteUser(owner);
    return { accountId, ownerReady };
  }

  /**
   * Transfère la part vendeur (après commission plateforme) vers le compte Connect.
   * Idempotent : ne recrée pas si `stripeTransferId` est déjà présent sur la commande.
   */
  async transferForPaidOrder(args: {
    orderId: string;
    storeId: string;
    goodsCents: number;
    shipCents: number;
    stripeParentPaymentId: string;
  }): Promise<StoreTransferResult> {
    const grossCents = Math.max(
      0,
      Math.round(args.goodsCents) + Math.round(args.shipCents),
    );
    const split =
      await this.platformFees.computeVendorTransferSplitFromSettings(grossCents);

    if (!this.transfersEnabled()) {
      return {
        transferred: false,
        transferCents: split.transferCents,
        platformFeeCents: split.platformFeeCents,
        stripeProcessingFeeCents: 0,
        grossCents: split.grossCents,
        skippedReason: 'transfers_disabled',
      };
    }

    if (!Types.ObjectId.isValid(args.orderId)) {
      throw new NotFoundException('order_not_found');
    }

    const order = await this.orderModel
      .findById(args.orderId)
      .select(
        'stripeTransferId stripeTransferAmountCents platformFeeCents stripeProcessingFeeCents stripeParentPaymentId',
      )
      .lean()
      .exec();
    if (!order) {
      throw new NotFoundException('order_not_found');
    }

    if (order.stripeTransferId) {
      return {
        transferred: true,
        transferId: order.stripeTransferId,
        transferCents:
          typeof order.stripeTransferAmountCents === 'number'
            ? order.stripeTransferAmountCents
            : split.transferCents,
        platformFeeCents:
          typeof order.platformFeeCents === 'number'
            ? order.platformFeeCents
            : split.platformFeeCents,
        stripeProcessingFeeCents:
          typeof order.stripeProcessingFeeCents === 'number'
            ? order.stripeProcessingFeeCents
            : 0,
        grossCents: split.grossCents,
        skippedReason: 'already_transferred',
      };
    }

    const { accountId, ownerReady } = await this.ownerConnectAccountId(
      args.storeId,
    );
    if (!ownerReady || !accountId) {
      await this.orderModel.updateOne(
        { _id: args.orderId },
        {
          $set: {
            platformFeeCents: split.platformFeeCents,
            stripeProcessingFeeCents: 0,
          },
        },
      );
      return {
        transferred: false,
        transferCents: split.transferCents,
        platformFeeCents: split.platformFeeCents,
        stripeProcessingFeeCents: 0,
        grossCents: split.grossCents,
        skippedReason: 'connect_onboarding_incomplete',
      };
    }

    if (split.transferCents < 1) {
      await this.orderModel.updateOne(
        { _id: args.orderId },
        {
          $set: {
            platformFeeCents: split.platformFeeCents,
            stripeProcessingFeeCents: 0,
            stripeTransferAmountCents: 0,
          },
        },
      );
      return {
        transferred: false,
        transferCents: 0,
        platformFeeCents: split.platformFeeCents,
        stripeProcessingFeeCents: 0,
        grossCents: split.grossCents,
        skippedReason: 'transfer_amount_zero',
      };
    }

    const parentId =
      args.stripeParentPaymentId.trim() ||
      String(order.stripeParentPaymentId ?? '').trim();
    const chargeId = parentId ? await this.resolveChargeId(parentId) : null;
    if (!chargeId) {
      this.logger.warn(
        `Connect transfer: charge unresolved for order ${args.orderId} parent=${parentId}`,
      );
      return {
        transferred: false,
        transferCents: split.transferCents,
        platformFeeCents: split.platformFeeCents,
        stripeProcessingFeeCents: 0,
        grossCents: split.grossCents,
        skippedReason: 'charge_unresolved',
      };
    }

    const currency =
      this.config.get<string>('STRIPE_CONNECT_TRANSFER_CURRENCY')?.trim() ||
      'cad';
    const stripeProcessingFeeShareCents = await this.estimateStripeFeeShareCents({
      chargeId,
      orderGrossCents: split.grossCents,
      transferBeforeStripeFeesCents: split.transferCents,
    });
    const transferCents = Math.max(
      0,
      split.transferCents - stripeProcessingFeeShareCents,
    );

    if (transferCents < 1) {
      await this.orderModel.updateOne(
        { _id: args.orderId },
        {
          $set: {
            platformFeeCents: split.platformFeeCents,
            stripeProcessingFeeCents: stripeProcessingFeeShareCents,
            stripeTransferAmountCents: 0,
          },
        },
      );
      return {
        transferred: false,
        transferCents: 0,
        platformFeeCents: split.platformFeeCents,
        stripeProcessingFeeCents: stripeProcessingFeeShareCents,
        grossCents: split.grossCents,
        skippedReason: 'transfer_amount_zero_after_stripe_fee',
      };
    }

    try {
      const transfer = await this.stripe().transfers.create(
        {
          amount: transferCents,
          currency: currency.toLowerCase(),
          destination: accountId,
          source_transaction: chargeId,
          transfer_group: parentId || undefined,
          metadata: {
            orderId: args.orderId,
            storeId: args.storeId,
            platform: 'africa-meals',
            platformFeeCents: String(split.platformFeeCents),
            stripeProcessingFeeCents: String(stripeProcessingFeeShareCents),
            grossCents: String(split.grossCents),
          },
        },
        { idempotencyKey: `transfer-order-${args.orderId}` },
      );

      await this.orderModel.updateOne(
        { _id: args.orderId },
        {
          $set: {
            stripeTransferId: transfer.id,
            stripeTransferAmountCents: transferCents,
            platformFeeCents: split.platformFeeCents,
            stripeProcessingFeeCents: stripeProcessingFeeShareCents,
            stripeTransferReversalId: null,
          },
          $unset: { stripeTransferReversalAmountCents: '' },
        },
      );

      this.logger.log(
        `Connect transfer ${transfer.id}: ${transferCents / 100} ${currency} → ${accountId} (order ${args.orderId}, stripeFeeShare=${stripeProcessingFeeShareCents / 100})`,
      );

      return {
        transferred: true,
        transferId: transfer.id,
        transferCents,
        platformFeeCents: split.platformFeeCents,
        stripeProcessingFeeCents: stripeProcessingFeeShareCents,
        grossCents: split.grossCents,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `Connect transfer failed order ${args.orderId}: ${msg}`,
      );
      await this.orderModel.updateOne(
        { _id: args.orderId },
        {
          $set: {
            platformFeeCents: split.platformFeeCents,
            stripeProcessingFeeCents: stripeProcessingFeeShareCents,
          },
        },
      );
      return {
        transferred: false,
        transferCents,
        platformFeeCents: split.platformFeeCents,
        stripeProcessingFeeCents: stripeProcessingFeeShareCents,
        grossCents: split.grossCents,
        skippedReason: `stripe_error:${msg}`.slice(0, 200),
      };
    }
  }

  /**
   * Annule partiellement ou totalement le transfer vendeur (remboursement client).
   */
  async reverseTransferForRefund(args: {
    orderId: string;
    customerRefundCents: number;
  }): Promise<{ reversed: boolean; reversalId?: string; reversalCents: number }> {
    if (!this.transfersEnabled()) {
      return { reversed: false, reversalCents: 0 };
    }
    if (!Types.ObjectId.isValid(args.orderId)) {
      return { reversed: false, reversalCents: 0 };
    }

    const order = await this.orderModel
      .findById(args.orderId)
      .select(
        'stripeTransferId stripeTransferAmountCents stripeTransferReversalId stripeTransferReversalAmountCents stripeChargedGoodsCents stripeChargedShipCents',
      )
      .lean()
      .exec();
    if (!order?.stripeTransferId) {
      return { reversed: false, reversalCents: 0 };
    }

    const transferCents = Math.max(
      0,
      Number(order.stripeTransferAmountCents ?? 0),
    );
    const alreadyReversed = Math.max(
      0,
      Number(order.stripeTransferReversalAmountCents ?? 0),
    );
    const remaining = transferCents - alreadyReversed;
    if (remaining < 1) {
      return { reversed: false, reversalCents: 0 };
    }

    const goods = Number(order.stripeChargedGoodsCents ?? 0);
    const ship = Number(order.stripeChargedShipCents ?? 0);
    const gross = goods + ship;
    const refundCents = Math.max(1, Math.round(args.customerRefundCents));

    let reversalCents = remaining;
    if (gross > 0 && refundCents < gross) {
      reversalCents = Math.min(
        remaining,
        Math.max(1, Math.round((transferCents * refundCents) / gross)),
      );
    }

    try {
      const reversal = await this.stripe().transfers.createReversal(
        order.stripeTransferId,
        {
          amount: reversalCents,
          metadata: {
            orderId: args.orderId,
            platform: 'africa-meals',
            reason: 'refund',
          },
        },
        { idempotencyKey: `transfer-reversal-${args.orderId}-${refundCents}` },
      );

      const newReversedTotal = alreadyReversed + reversalCents;
      await this.orderModel.updateOne(
        { _id: args.orderId },
        {
          $set: {
            stripeTransferReversalId: reversal.id,
            stripeTransferReversalAmountCents: newReversedTotal,
          },
        },
      );

      this.logger.log(
        `Connect transfer reversal ${reversal.id}: ${reversalCents / 100} CAD on ${order.stripeTransferId}`,
      );

      return {
        reversed: true,
        reversalId: reversal.id,
        reversalCents,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `Connect transfer reversal skipped order ${args.orderId}: ${msg}`,
      );
      return { reversed: false, reversalCents: 0 };
    }
  }
}
