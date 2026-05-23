import { isStripeConnectOnboardingCompleteUser } from '@modules/billing/stripe/stripe-connect-visibility';
import {
  allocatePlatformFeeToGoodsCents,
  allocateStripeProcessingFeeShareCents,
  computeDeliveryNetCentsBeforeStripe,
  effectiveStripeProcessingFeeCents,
} from '@modules/billing/stripe/stripe-processing-fee.util';
import { PlatformFeesService } from '@modules/platform-fees/platform-fees.service';
import { PlatformShippingSettingsService } from '@modules/platform-shipping-settings/platform-shipping-settings.service';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { OrderModel } from '@schemas/order.schema';
import { StripeProcessedCheckoutModel } from '@schemas/stripe-processed-checkout.schema';
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

export type DeliveryTransferResult = {
  transferred: boolean;
  transferId?: string;
  transferCents: number;
  stripeProcessingFeeCents: number;
  grossShipCents: number;
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
    private readonly platformShipping: PlatformShippingSettingsService,
    @InjectModel(OrderModel.name)
    private readonly orderModel: Model<OrderModel>,
    @InjectModel(StripeProcessedCheckoutModel.name)
    private readonly processedCheckoutModel: Model<StripeProcessedCheckoutModel>,
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

  private async paymentTotalCentsForParent(
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

  private async resolveTotalStripeFeeCents(args: {
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

  private stripeFeeShareCents(args: {
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

  private async agentConnectAccountId(
    agentUserId: string,
  ): Promise<{ accountId: string | null; agentReady: boolean }> {
    if (!Types.ObjectId.isValid(agentUserId)) {
      return { accountId: null, agentReady: false };
    }
    const agent = await this.userModel
      .findById(agentUserId)
      .select(
        'stripeConnectAccountId stripeConnectChargesEnabled stripeConnectPayoutsEnabled stripeConnectDetailsSubmitted stripeConnectDisabledReason stripeConnectRequirementsDue stripeConnectRequirementsPastDue',
      )
      .lean()
      .exec();
    const accountId = agent?.stripeConnectAccountId?.trim() || null;
    const agentReady = isStripeConnectOnboardingCompleteUser(agent);
    return { accountId, agentReady };
  }

  /**
   * Transfère la part vendeur (articles uniquement, après commission plateforme et frais Stripe)
   * vers le compte Connect. La part livraison est versée via `transferDeliveryShareForCompletedOrder`.
   */
  async transferForPaidOrder(args: {
    orderId: string;
    storeId: string;
    goodsCents: number;
    shipCents: number;
    stripeParentPaymentId: string;
    /** Montant total encaissé sur la charge (toutes boutiques + frais transaction), en centimes. */
    paymentTotalCents?: number;
  }): Promise<StoreTransferResult> {
    const goodsCents = Math.max(0, Math.round(args.goodsCents));
    const shipCents = Math.max(0, Math.round(args.shipCents));
    const orderGrossCents = goodsCents + shipCents;

    const split =
      await this.platformFees.computeVendorTransferSplitFromSettings(
        orderGrossCents,
      );

    const platformFeeOnGoods = allocatePlatformFeeToGoodsCents({
      platformFeeCents: split.platformFeeCents,
      goodsCents,
      shipCents,
    });
    const vendorBeforeStripe = Math.max(0, goodsCents - platformFeeOnGoods);

    if (!this.transfersEnabled()) {
      return {
        transferred: false,
        transferCents: vendorBeforeStripe,
        platformFeeCents: platformFeeOnGoods,
        stripeProcessingFeeCents: 0,
        grossCents: goodsCents,
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
            : vendorBeforeStripe,
        platformFeeCents:
          typeof order.platformFeeCents === 'number'
            ? order.platformFeeCents
            : platformFeeOnGoods,
        stripeProcessingFeeCents:
          typeof order.stripeProcessingFeeCents === 'number'
            ? order.stripeProcessingFeeCents
            : 0,
        grossCents: goodsCents,
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
            platformFeeCents: platformFeeOnGoods,
            stripeProcessingFeeCents: 0,
          },
        },
      );
      return {
        transferred: false,
        transferCents: vendorBeforeStripe,
        platformFeeCents: platformFeeOnGoods,
        stripeProcessingFeeCents: 0,
        grossCents: goodsCents,
        skippedReason: 'connect_onboarding_incomplete',
      };
    }

    if (vendorBeforeStripe < 1) {
      await this.orderModel.updateOne(
        { _id: args.orderId },
        {
          $set: {
            platformFeeCents: platformFeeOnGoods,
            stripeProcessingFeeCents: 0,
            stripeTransferAmountCents: 0,
          },
        },
      );
      return {
        transferred: false,
        transferCents: 0,
        platformFeeCents: platformFeeOnGoods,
        stripeProcessingFeeCents: 0,
        grossCents: goodsCents,
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
        transferCents: vendorBeforeStripe,
        platformFeeCents: platformFeeOnGoods,
        stripeProcessingFeeCents: 0,
        grossCents: goodsCents,
        skippedReason: 'charge_unresolved',
      };
    }

    const paymentAmountCents = await this.paymentTotalCentsForParent(
      parentId,
      args.paymentTotalCents ?? orderGrossCents,
    );
    const totalStripeFeeCents = await this.resolveTotalStripeFeeCents({
      chargeId,
      paymentAmountCents,
    });
    const stripeProcessingFeeShareCents = this.stripeFeeShareCents({
      totalStripeFeeCents,
      paymentAmountCents,
      sliceAmountCents: goodsCents,
      maxDeductibleCents: vendorBeforeStripe,
    });
    const transferCents = Math.max(
      0,
      vendorBeforeStripe - stripeProcessingFeeShareCents,
    );

    if (transferCents < 1) {
      await this.orderModel.updateOne(
        { _id: args.orderId },
        {
          $set: {
            platformFeeCents: platformFeeOnGoods,
            stripeProcessingFeeCents: stripeProcessingFeeShareCents,
            stripeTransferAmountCents: 0,
          },
        },
      );
      return {
        transferred: false,
        transferCents: 0,
        platformFeeCents: platformFeeOnGoods,
        stripeProcessingFeeCents: stripeProcessingFeeShareCents,
        grossCents: goodsCents,
        skippedReason: 'transfer_amount_zero_after_stripe_fee',
      };
    }

    const currency =
      this.config.get<string>('STRIPE_CONNECT_TRANSFER_CURRENCY')?.trim() ||
      'cad';

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
            transferKind: 'vendor_goods',
            platformFeeCents: String(platformFeeOnGoods),
            stripeProcessingFeeCents: String(stripeProcessingFeeShareCents),
            grossGoodsCents: String(goodsCents),
            shipCentsHeld: String(shipCents),
          },
        },
        { idempotencyKey: `transfer-order-vendor-${args.orderId}` },
      );

      await this.orderModel.updateOne(
        { _id: args.orderId },
        {
          $set: {
            stripeTransferId: transfer.id,
            stripeTransferAmountCents: transferCents,
            platformFeeCents: platformFeeOnGoods,
            stripeProcessingFeeCents: stripeProcessingFeeShareCents,
            stripeTransferReversalId: null,
          },
          $unset: { stripeTransferReversalAmountCents: '' },
        },
      );

      this.logger.log(
        `Connect vendor transfer ${transfer.id}: ${transferCents / 100} ${currency} → ${accountId} (order ${args.orderId}, stripeFee=${stripeProcessingFeeShareCents / 100})`,
      );

      return {
        transferred: true,
        transferId: transfer.id,
        transferCents,
        platformFeeCents: platformFeeOnGoods,
        stripeProcessingFeeCents: stripeProcessingFeeShareCents,
        grossCents: goodsCents,
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
            platformFeeCents: platformFeeOnGoods,
            stripeProcessingFeeCents: stripeProcessingFeeShareCents,
          },
        },
      );
      return {
        transferred: false,
        transferCents,
        platformFeeCents: platformFeeOnGoods,
        stripeProcessingFeeCents: stripeProcessingFeeShareCents,
        grossCents: goodsCents,
        skippedReason: `stripe_error:${msg}`.slice(0, 200),
      };
    }
  }

  /**
   * Verse la part livraison au livreur assigné (après retenue plateforme livraison et frais Stripe).
   * À appeler lorsque la commande livrée passe en `completed`.
   */
  async transferDeliveryShareForCompletedOrder(args: {
    orderId: string;
    paymentTotalCents?: number;
  }): Promise<DeliveryTransferResult> {
    const empty: DeliveryTransferResult = {
      transferred: false,
      transferCents: 0,
      stripeProcessingFeeCents: 0,
      grossShipCents: 0,
    };

    if (!this.transfersEnabled()) {
      return { ...empty, skippedReason: 'transfers_disabled' };
    }
    if (!Types.ObjectId.isValid(args.orderId)) {
      return { ...empty, skippedReason: 'invalid_order_id' };
    }

    const order = await this.orderModel
      .findById(args.orderId)
      .select(
        'shouldShip assignedDeliveryUser stripeParentPaymentId stripeChargedShipCents shippingPrice stripeDeliveryTransferId stripeDeliveryTransferAmountCents stripeDeliveryProcessingFeeCents status',
      )
      .lean()
      .exec();
    if (!order) {
      return { ...empty, skippedReason: 'order_not_found' };
    }
    if (!order.shouldShip) {
      return { ...empty, skippedReason: 'not_delivery_order' };
    }
    if (order.stripeDeliveryTransferId) {
      return {
        transferred: true,
        transferId: order.stripeDeliveryTransferId,
        transferCents: order.stripeDeliveryTransferAmountCents ?? 0,
        stripeProcessingFeeCents: order.stripeDeliveryProcessingFeeCents ?? 0,
        grossShipCents:
          order.stripeChargedShipCents ??
          Math.round((Number(order.shippingPrice) || 0) * 100),
        skippedReason: 'already_transferred',
      };
    }

    const agentId = order.assignedDeliveryUser
      ? String(order.assignedDeliveryUser)
      : '';
    if (!agentId) {
      return { ...empty, skippedReason: 'no_assigned_delivery_agent' };
    }

    const shipCents = Math.max(
      0,
      Math.round(
        Number(order.stripeChargedShipCents ?? 0) ||
          Math.round((Number(order.shippingPrice) || 0) * 100),
      ),
    );
    if (shipCents < 1) {
      return { ...empty, skippedReason: 'no_shipping_amount' };
    }

    const shippingSettings = await this.platformShipping.getPublicSettings();
    const deliveryNetBeforeStripe = computeDeliveryNetCentsBeforeStripe({
      shipCents,
      deliveryWithheldFeeMode: shippingSettings.deliveryWithheldFeeMode,
      deliveryWithheldFeeFixed: shippingSettings.deliveryWithheldFeeFixed,
      deliveryWithheldFeePercent: shippingSettings.deliveryWithheldFeePercent,
    });
    if (deliveryNetBeforeStripe < 1) {
      return {
        ...empty,
        grossShipCents: shipCents,
        skippedReason: 'delivery_net_zero_after_withheld',
      };
    }

    const { accountId, agentReady } = await this.agentConnectAccountId(agentId);
    if (!agentReady || !accountId) {
      return {
        ...empty,
        grossShipCents: shipCents,
        skippedReason: 'delivery_connect_onboarding_incomplete',
      };
    }

    const parentId = String(order.stripeParentPaymentId ?? '').trim();
    const chargeId = parentId ? await this.resolveChargeId(parentId) : null;
    if (!chargeId) {
      return {
        ...empty,
        grossShipCents: shipCents,
        skippedReason: 'charge_unresolved',
      };
    }

    const paymentAmountCents = await this.paymentTotalCentsForParent(
      parentId,
      args.paymentTotalCents ?? shipCents,
    );
    const totalStripeFeeCents = await this.resolveTotalStripeFeeCents({
      chargeId,
      paymentAmountCents,
    });
    const stripeProcessingFeeShareCents = this.stripeFeeShareCents({
      totalStripeFeeCents,
      paymentAmountCents,
      sliceAmountCents: shipCents,
      maxDeductibleCents: deliveryNetBeforeStripe,
    });
    const transferCents = Math.max(
      0,
      deliveryNetBeforeStripe - stripeProcessingFeeShareCents,
    );

    if (transferCents < 1) {
      await this.orderModel.updateOne(
        { _id: args.orderId },
        {
          $set: {
            stripeDeliveryProcessingFeeCents: stripeProcessingFeeShareCents,
            stripeDeliveryTransferAmountCents: 0,
          },
        },
      );
      return {
        transferred: false,
        transferCents: 0,
        stripeProcessingFeeCents: stripeProcessingFeeShareCents,
        grossShipCents: shipCents,
        skippedReason: 'transfer_amount_zero_after_stripe_fee',
      };
    }

    const currency =
      this.config.get<string>('STRIPE_CONNECT_TRANSFER_CURRENCY')?.trim() ||
      'cad';

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
            agentUserId: agentId,
            platform: 'africa-meals',
            transferKind: 'delivery_shipping',
            stripeProcessingFeeCents: String(stripeProcessingFeeShareCents),
            grossShipCents: String(shipCents),
          },
        },
        { idempotencyKey: `transfer-order-delivery-${args.orderId}` },
      );

      await this.orderModel.updateOne(
        { _id: args.orderId },
        {
          $set: {
            stripeDeliveryTransferId: transfer.id,
            stripeDeliveryTransferAmountCents: transferCents,
            stripeDeliveryProcessingFeeCents: stripeProcessingFeeShareCents,
          },
        },
      );

      this.logger.log(
        `Connect delivery transfer ${transfer.id}: ${transferCents / 100} ${currency} → ${accountId} (order ${args.orderId}, stripeFee=${stripeProcessingFeeShareCents / 100})`,
      );

      return {
        transferred: true,
        transferId: transfer.id,
        transferCents,
        stripeProcessingFeeCents: stripeProcessingFeeShareCents,
        grossShipCents: shipCents,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `Connect delivery transfer failed order ${args.orderId}: ${msg}`,
      );
      return {
        transferred: false,
        transferCents,
        stripeProcessingFeeCents: stripeProcessingFeeShareCents,
        grossShipCents: shipCents,
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
        'stripeTransferId stripeTransferAmountCents stripeTransferReversalId stripeTransferReversalAmountCents stripeChargedGoodsCents stripeChargedShipCents stripeDeliveryTransferId stripeDeliveryTransferAmountCents stripeDeliveryTransferReversalAmountCents',
      )
      .lean()
      .exec();
    if (!order) {
      return { reversed: false, reversalCents: 0 };
    }

    let totalReversed = 0;
    let lastReversalId: string | undefined;

    if (order.stripeTransferId) {
      const vendorRev = await this.reverseSingleTransfer({
        transferId: order.stripeTransferId,
        transferCents: Number(order.stripeTransferAmountCents ?? 0),
        alreadyReversedCents: Number(
          order.stripeTransferReversalAmountCents ?? 0,
        ),
        orderId: args.orderId,
        refundCents: args.customerRefundCents,
        grossCents:
          Number(order.stripeChargedGoodsCents ?? 0) +
          Number(order.stripeChargedShipCents ?? 0),
        idempotencySuffix: 'vendor',
        orderFieldPrefix: 'stripeTransfer',
      });
      totalReversed += vendorRev.reversalCents;
      lastReversalId = vendorRev.reversalId ?? lastReversalId;
    }

    if (order.stripeDeliveryTransferId) {
      const deliveryRev = await this.reverseSingleTransfer({
        transferId: order.stripeDeliveryTransferId,
        transferCents: Number(order.stripeDeliveryTransferAmountCents ?? 0),
        alreadyReversedCents: Number(
          order.stripeDeliveryTransferReversalAmountCents ?? 0,
        ),
        orderId: args.orderId,
        refundCents: args.customerRefundCents,
        grossCents: Number(order.stripeChargedShipCents ?? 0),
        idempotencySuffix: 'delivery',
        orderFieldPrefix: 'stripeDeliveryTransfer',
      });
      totalReversed += deliveryRev.reversalCents;
      lastReversalId = deliveryRev.reversalId ?? lastReversalId;
    }

    return {
      reversed: totalReversed > 0,
      reversalId: lastReversalId,
      reversalCents: totalReversed,
    };
  }

  private async reverseSingleTransfer(args: {
    transferId: string;
    transferCents: number;
    alreadyReversedCents: number;
    orderId: string;
    refundCents: number;
    grossCents: number;
    idempotencySuffix: string;
    orderFieldPrefix: 'stripeTransfer' | 'stripeDeliveryTransfer';
  }): Promise<{ reversed: boolean; reversalId?: string; reversalCents: number }> {
    const transferCents = Math.max(0, args.transferCents);
    const alreadyReversed = Math.max(0, args.alreadyReversedCents);
    const remaining = transferCents - alreadyReversed;
    if (remaining < 1) {
      return { reversed: false, reversalCents: 0 };
    }

    const gross = Math.max(0, args.grossCents);
    const refundCents = Math.max(1, Math.round(args.refundCents));

    let reversalCents = remaining;
    if (gross > 0 && refundCents < gross) {
      reversalCents = Math.min(
        remaining,
        Math.max(1, Math.round((transferCents * refundCents) / gross)),
      );
    }

    try {
      const reversal = await this.stripe().transfers.createReversal(
        args.transferId,
        {
          amount: reversalCents,
          metadata: {
            orderId: args.orderId,
            platform: 'africa-meals',
            reason: 'refund',
            transferKind: args.idempotencySuffix,
          },
        },
        {
          idempotencyKey: `transfer-reversal-${args.idempotencySuffix}-${args.orderId}-${refundCents}`,
        },
      );

      const newReversedTotal = alreadyReversed + reversalCents;
      const reversalField =
        args.orderFieldPrefix === 'stripeTransfer'
          ? {
              stripeTransferReversalId: reversal.id,
              stripeTransferReversalAmountCents: newReversedTotal,
            }
          : {
              stripeDeliveryTransferReversalId: reversal.id,
              stripeDeliveryTransferReversalAmountCents: newReversedTotal,
            };

      await this.orderModel.updateOne(
        { _id: args.orderId },
        { $set: reversalField },
      );

      this.logger.log(
        `Connect transfer reversal ${reversal.id}: ${reversalCents / 100} CAD on ${args.transferId} (${args.idempotencySuffix})`,
      );

      return {
        reversed: true,
        reversalId: reversal.id,
        reversalCents,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `Connect transfer reversal skipped order ${args.orderId} (${args.idempotencySuffix}): ${msg}`,
      );
      return { reversed: false, reversalCents: 0 };
    }
  }
}
