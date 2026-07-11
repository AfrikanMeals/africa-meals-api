import { isStripeConnectOnboardingCompleteUser } from '@modules/billing/stripe/stripe-connect-visibility';
import { StripeChargeFeeService } from '@modules/billing/stripe/stripe-charge-fee.service';
import {
  buildConnectTransferIdempotencyKey,
  isStripeIdempotencyMismatchError,
  type ConnectTransferIdempotencyKind,
} from '@modules/billing/stripe/stripe-connect-transfer-idempotency.util';
import {
  allocatePlatformFeeToGoodsCents,
  computeDeliveryNetCentsBeforeStripe,
  scaleStorePayoutMinorToPaymentShare,
} from '@modules/billing/stripe/stripe-processing-fee.util';
import { normalizeStripeCurrencyCode } from '@utils/stripe-currency-amount.util';
import { PlatformFeesService } from '@modules/platform-fees/platform-fees.service';
import { SubscriptionPlanOrderCommissionService, mapOrderLineItemsToCommissionLines } from '@modules/subscriptions/subscription-plan-order-commission.service';
import { OrdeLineItem } from '@schemas/order.schema';
import { PlatformShippingSettingsService } from '@modules/platform-shipping-settings/platform-shipping-settings.service';
import { resolvePlatformShippingRegionCode } from '@modules/platform-shipping-settings/platform-shipping-region.util';
import { countryCodeFromStoreRegion } from '@modules/supported-countries/region-tax.util';
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

/** Shape minimale d’un transfer Connect (évite `Stripe.Transfer` sous import CJS). */
type ConnectTransferRow = {
  id: string;
  amount?: number | null;
  source_transaction?: string | { id?: string } | null;
  metadata?: Record<string, string> | null;
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

  constructor(
    private readonly config: ConfigService,
    private readonly platformFees: PlatformFeesService,
    private readonly planOrderCommission: SubscriptionPlanOrderCommissionService,
    private readonly platformShipping: PlatformShippingSettingsService,
    private readonly stripeFees: StripeChargeFeeService,
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

  /** Résout l’id charge `ch_…` liée à un `pi_…` ou `cs_…`. */
  async resolveChargeId(stripeParentPaymentId: string): Promise<string | null> {
    return this.stripeFees.resolveChargeId(stripeParentPaymentId);
  }

  /**
   * Retrouve un transfer déjà créé (retry admin / webhook) via transfer_group
   * ou destination + metadata orderId/transferKind — évite un double versement
   * quand la clé d’idempotency change (montant / compte Connect).
   */
  private async findExistingConnectTransfer(args: {
    orderId: string;
    transferKind: string;
    transferGroup?: string;
    destination?: string;
    chargeId?: string;
  }): Promise<ConnectTransferRow | null> {
    const orderId = String(args.orderId ?? '').trim();
    const transferKind = String(args.transferKind ?? '').trim();
    if (!orderId || !transferKind) return null;

    const stripe = this.stripe();
    const sourceTxId = (t: ConnectTransferRow): string => {
      const src = t.source_transaction;
      if (typeof src === 'string') return src;
      if (src && typeof src === 'object' && src.id) return String(src.id);
      return '';
    };
    const matches = (t: ConnectTransferRow): boolean => {
      const metaOrder = String(t.metadata?.orderId ?? '').trim();
      const metaKind = String(t.metadata?.transferKind ?? '').trim();
      if (metaOrder === orderId && metaKind === transferKind) return true;
      // Transfers legacy sans transferKind mais même orderId + charge.
      if (
        args.chargeId &&
        sourceTxId(t) === args.chargeId &&
        metaOrder === orderId &&
        (!metaKind || metaKind === transferKind)
      ) {
        return true;
      }
      return false;
    };

    const scan = async (listOpts: {
      transfer_group?: string;
      destination?: string;
      limit?: number;
      starting_after?: string;
    }): Promise<ConnectTransferRow | null> => {
      let startingAfter: string | undefined;
      for (let page = 0; page < 8; page++) {
        const batch = await stripe.transfers.list({
          ...listOpts,
          limit: listOpts.limit ?? 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        const hit = (batch.data as ConnectTransferRow[]).find(matches);
        if (hit) return hit;
        if (!batch.has_more || !batch.data.length) break;
        startingAfter = batch.data[batch.data.length - 1]?.id;
      }
      return null;
    };

    try {
      if (args.transferGroup) {
        const byGroup = await scan({ transfer_group: args.transferGroup });
        if (byGroup) return byGroup;
      }
      if (args.destination) {
        const byDest = await scan({ destination: args.destination });
        if (byDest) return byDest;
      }
      // Dernier recours : pages récentes (dev / peu de volume) filtrées charge.
      if (args.chargeId) {
        const recent = await scan({});
        if (recent) return recent;
      }
    } catch (e) {
      this.logger.warn(
        `findExistingConnectTransfer order=${orderId} kind=${transferKind}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    return null;
  }

  private transferIdempotencyKey(args: {
    kind: ConnectTransferIdempotencyKind;
    orderId: string;
    amountCents: number;
    destination: string;
    chargeId: string;
  }): string {
    return buildConnectTransferIdempotencyKey(args);
  }

  /**
   * Crée un transfer Connect avec clé paramétrée.
   * Si Stripe renvoie un conflit d’idempotency (clé legacy empoisonnée) :
   * 1) réconcilie un transfer existant ; 2) sinon retente avec une clé unique.
   */
  private async createConnectTransfer(args: {
    kind: ConnectTransferIdempotencyKind;
    orderId: string;
    amountCents: number;
    currency: string;
    destination: string;
    chargeId: string;
    transferGroup?: string;
    metadata: Record<string, string>;
    transferKind: string;
  }): Promise<ConnectTransferRow> {
    const params = {
      amount: args.amountCents,
      currency: args.currency,
      destination: args.destination,
      source_transaction: args.chargeId,
      transfer_group: args.transferGroup || undefined,
      metadata: args.metadata,
    };
    const baseKey = this.transferIdempotencyKey({
      kind: args.kind,
      orderId: args.orderId,
      amountCents: args.amountCents,
      destination: args.destination,
      chargeId: args.chargeId,
    });
    const stripe = this.stripe();

    try {
      return (await stripe.transfers.create(params, {
        idempotencyKey: baseKey,
      })) as ConnectTransferRow;
    } catch (e) {
      if (!isStripeIdempotencyMismatchError(e)) throw e;

      const existing = await this.findExistingConnectTransfer({
        orderId: args.orderId,
        transferKind: args.transferKind,
        transferGroup: args.transferGroup,
        destination: args.destination,
        chargeId: args.chargeId,
      });
      if (existing) {
        this.logger.warn(
          `Connect transfer ${args.transferKind} reconciled after idempotency mismatch ${existing.id} order ${args.orderId}`,
        );
        return existing;
      }

      const retryKey = `${baseKey}-r${Date.now()}`.slice(0, 255);
      this.logger.warn(
        `Connect transfer ${args.transferKind} idempotency mismatch without existing transfer — retry key order=${args.orderId}`,
      );
      return (await stripe.transfers.create(params, {
        idempotencyKey: retryKey,
      })) as ConnectTransferRow;
    }
  }

  private async totalPayoutGrossCentsForPayment(
    stripeParentPaymentId: string,
  ): Promise<number> {
    const parentId = stripeParentPaymentId.trim();
    if (!parentId) return 0;
    const orders = await this.orderModel
      .find({ stripeParentPaymentId: parentId })
      .select('stripeChargedGoodsCents stripeChargedShipCents')
      .lean()
      .exec();
    let sum = 0;
    for (const o of orders) {
      sum += Math.max(0, Math.round(Number(o.stripeChargedGoodsCents ?? 0)));
      sum += Math.max(0, Math.round(Number(o.stripeChargedShipCents ?? 0)));
    }
    return sum;
  }

  private async connectTransferCurrency(
    chargeId: string,
    paymentCurrency?: string,
  ): Promise<string> {
    const configured =
      this.config.get<string>('STRIPE_CONNECT_TRANSFER_CURRENCY')?.trim() ||
      'cad';
    const snap = await this.stripeFees.chargeFeeSnapshot(chargeId);
    return normalizeStripeCurrencyCode(
      snap?.currency || paymentCurrency || configured,
    ).toLowerCase();
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
    /** Montant total encaissé sur la charge (toutes boutiques + frais transaction), en unités Stripe mineures. */
    paymentTotalCents?: number;
    /** Somme goods+ship du payout metadata (toutes boutiques) — pour aligner XAF/CAD. */
    totalPayoutGrossCents?: number;
    /** Devise du PaymentIntent / charge (ex. xaf, cad). */
    paymentCurrency?: string;
  }): Promise<StoreTransferResult> {
    let goodsCents = Math.max(0, Math.round(args.goodsCents));
    let shipCents = Math.max(0, Math.round(args.shipCents));
    const paymentCap = Math.max(0, Math.round(args.paymentTotalCents ?? 0));
    const totalPayoutGross = Math.max(0, Math.round(args.totalPayoutGrossCents ?? 0));
    if (paymentCap > 0 && totalPayoutGross > paymentCap) {
      const scaled = scaleStorePayoutMinorToPaymentShare({
        goodsCents,
        shipCents,
        totalPayoutGrossMinor: totalPayoutGross,
        paymentTotalMinor: paymentCap,
      });
      if (scaled.goodsCents !== goodsCents || scaled.shipCents !== shipCents) {
        this.logger.warn(
          `Connect transfer payout scaled order=${args.orderId} ` +
            `goods ${goodsCents}→${scaled.goodsCents} ship ${shipCents}→${scaled.shipCents} ` +
            `(payment=${paymentCap} payoutGross=${totalPayoutGross})`,
        );
      }
      goodsCents = scaled.goodsCents;
      shipCents = scaled.shipCents;
    }
    const orderGrossCents = goodsCents + shipCents;

    const orderDoc = await this.orderModel
      .findById(args.orderId)
      .select('items currency')
      .lean()
      .exec();
    const paymentCurrency = String(
      args.paymentCurrency ?? orderDoc?.currency ?? 'CAD',
    )
      .trim()
      .toUpperCase();
    const storeStrategy =
      await this.planOrderCommission.getCommissionRetrieveStrategyForStore(
        args.storeId,
      );
    const lineItems = mapOrderLineItemsToCommissionLines(
      orderDoc?.items as OrdeLineItem[] | undefined,
      paymentCurrency,
      storeStrategy,
    );

    const split =
      await this.planOrderCommission.computeVendorTransferSplitForStore(
        args.storeId,
        { goodsCents, shipCents, lineItems },
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

    const paymentAmountCents = await this.stripeFees.paymentTotalCentsForParent(
      parentId,
      args.paymentTotalCents ?? orderGrossCents,
    );
    const chargeSnap = await this.stripeFees.chargeFeeSnapshot(chargeId);
    const chargeAmountCents = Math.max(
      paymentAmountCents,
      chargeSnap?.amountCents ?? 0,
    );
    const totalStripeFeeCents = await this.stripeFees.totalProcessingFeeCents({
      chargeId,
      paymentAmountCents: chargeAmountCents,
    });
    // Montants commande en devise charge ; transfer Stripe = devise settlement (BT).
    const vendorBeforeStripeSettlement = this.stripeFees.toTransferMinorUnits(
      vendorBeforeStripe,
      chargeSnap,
    );
    const stripeProcessingFeeShareCents =
      this.stripeFees.allocateProcessingFeeShareCents({
        totalStripeFeeCents,
        paymentAmountCents: chargeAmountCents,
        sliceAmountCents: goodsCents,
        maxDeductibleCents: vendorBeforeStripeSettlement,
      });
    let transferCents = Math.max(
      0,
      vendorBeforeStripeSettlement - stripeProcessingFeeShareCents,
    );

    const remainingOnCharge =
      await this.stripeFees.remainingTransferableCents(chargeId);
    if (remainingOnCharge > 0) {
      transferCents = Math.min(transferCents, remainingOnCharge);
    } else {
      const settlementCap =
        chargeSnap?.settlementAmountCents &&
        chargeSnap.settlementAmountCents > 0
          ? chargeSnap.settlementAmountCents
          : this.stripeFees.toTransferMinorUnits(chargeAmountCents, chargeSnap);
      if (settlementCap > 0) {
        transferCents = Math.min(transferCents, settlementCap);
      }
    }

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

    const configuredCurrency =
      this.config.get<string>('STRIPE_CONNECT_TRANSFER_CURRENCY')?.trim() ||
      'cad';
    // Devise BT (settlement), pas charge.currency — sinon Stripe refuse source_transaction.
    const transferCurrency = normalizeStripeCurrencyCode(
      chargeSnap?.currency ||
        args.paymentCurrency ||
        configuredCurrency,
    ).toLowerCase();
    if (
      chargeSnap?.chargeCurrency &&
      chargeSnap.chargeCurrency !== transferCurrency
    ) {
      this.logger.log(
        `Connect vendor transfer FX order=${args.orderId}: ` +
          `charge=${chargeSnap.chargeCurrency} → settlement=${transferCurrency} ` +
          `rate=${chargeSnap.exchangeRate}`,
      );
    } else if (
      chargeSnap?.currency &&
      configuredCurrency.toLowerCase() !== chargeSnap.currency
    ) {
      this.logger.warn(
        `Connect transfer currency ${transferCurrency} (settlement) ` +
          `≠ STRIPE_CONNECT_TRANSFER_CURRENCY=${configuredCurrency} order=${args.orderId}`,
      );
    }

    const existingVendor = await this.findExistingConnectTransfer({
      orderId: args.orderId,
      transferKind: 'vendor_goods',
      transferGroup: parentId || undefined,
      destination: accountId,
      chargeId,
    });
    if (existingVendor) {
      const existingCents = Math.max(
        0,
        Math.round(Number(existingVendor.amount ?? 0)),
      );
      await this.orderModel.updateOne(
        { _id: args.orderId },
        {
          $set: {
            stripeTransferId: existingVendor.id,
            stripeTransferAmountCents: existingCents,
            platformFeeCents: platformFeeOnGoods,
            stripeProcessingFeeCents: stripeProcessingFeeShareCents,
            stripeTransferReversalId: null,
          },
          $unset: { stripeTransferReversalAmountCents: '' },
        },
      );
      this.logger.log(
        `Connect vendor transfer reconciled ${existingVendor.id}: ${existingCents} → ${accountId} (order ${args.orderId})`,
      );
      return {
        transferred: true,
        transferId: existingVendor.id,
        transferCents: existingCents,
        platformFeeCents: platformFeeOnGoods,
        stripeProcessingFeeCents: stripeProcessingFeeShareCents,
        grossCents: goodsCents,
        skippedReason: 'already_transferred',
      };
    }

    try {
      const transfer = await this.createConnectTransfer({
        kind: 'vendor',
        orderId: args.orderId,
        amountCents: transferCents,
        currency: transferCurrency,
        destination: accountId,
        chargeId,
        transferGroup: parentId || undefined,
        transferKind: 'vendor_goods',
        metadata: {
          orderId: args.orderId,
          storeId: args.storeId,
          platform: 'wise-eat',
          transferKind: 'vendor_goods',
          platformFeeCents: String(platformFeeOnGoods),
          stripeProcessingFeeCents: String(stripeProcessingFeeShareCents),
          grossGoodsCents: String(goodsCents),
          shipCentsHeld: String(shipCents),
        },
      });

      const savedCents = Math.max(
        0,
        Math.round(Number(transfer.amount ?? transferCents)),
      );
      await this.orderModel.updateOne(
        { _id: args.orderId },
        {
          $set: {
            stripeTransferId: transfer.id,
            stripeTransferAmountCents: savedCents,
            platformFeeCents: platformFeeOnGoods,
            stripeProcessingFeeCents: stripeProcessingFeeShareCents,
            stripeTransferReversalId: null,
          },
          $unset: { stripeTransferReversalAmountCents: '' },
        },
      );

      this.logger.log(
        `Connect vendor transfer ${transfer.id}: ${savedCents} ${transferCurrency} → ${accountId} (order ${args.orderId}, stripeFee=${
          stripeProcessingFeeShareCents
        })`,
      );

      return {
        transferred: true,
        transferId: transfer.id,
        transferCents: savedCents,
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
        'shouldShip assignedDeliveryUser stripeParentPaymentId stripeChargedGoodsCents stripeChargedShipCents shippingPrice stripeDeliveryTransferId stripeDeliveryTransferAmountCents stripeDeliveryProcessingFeeCents status taxCountryCode store',
      )
      .populate({ path: 'store', select: 'region currency address' })
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

    const shipCentsRaw = Math.max(
      0,
      Math.round(
        Number(order.stripeChargedShipCents ?? 0) ||
          Math.round((Number(order.shippingPrice) || 0) * 100),
      ),
    );
    const goodsCents = Math.max(
      0,
      Math.round(Number(order.stripeChargedGoodsCents ?? 0)),
    );
    if (shipCentsRaw < 1) {
      return { ...empty, skippedReason: 'no_shipping_amount' };
    }

    const parentId = String(order.stripeParentPaymentId ?? '').trim();
    const chargeId = parentId ? await this.resolveChargeId(parentId) : null;
    if (!chargeId) {
      return {
        ...empty,
        grossShipCents: shipCentsRaw,
        skippedReason: 'charge_unresolved',
      };
    }

    const paymentAmountCents = await this.stripeFees.paymentTotalCentsForParent(
      parentId,
      args.paymentTotalCents ?? shipCentsRaw,
    );
    const chargeSnap = await this.stripeFees.chargeFeeSnapshot(chargeId);
    const chargeAmountCents = Math.max(
      paymentAmountCents,
      chargeSnap?.amountCents ?? 0,
    );

    let shipCents = shipCentsRaw;
    const totalPayoutGross =
      await this.totalPayoutGrossCentsForPayment(parentId);
    if (
      chargeAmountCents > 0 &&
      totalPayoutGross > chargeAmountCents &&
      goodsCents + shipCentsRaw > 0
    ) {
      const scaled = scaleStorePayoutMinorToPaymentShare({
        goodsCents,
        shipCents: shipCentsRaw,
        totalPayoutGrossMinor: totalPayoutGross,
        paymentTotalMinor: chargeAmountCents,
      });
      if (scaled.shipCents !== shipCentsRaw) {
        this.logger.warn(
          `Connect delivery payout scaled order=${args.orderId} ` +
            `ship ${shipCentsRaw}→${scaled.shipCents} ` +
            `(payment=${chargeAmountCents} payoutGross=${totalPayoutGross})`,
        );
      }
      shipCents = scaled.shipCents;
    }
    if (shipCents < 1) {
      return { ...empty, skippedReason: 'no_shipping_amount' };
    }

    const regionCode = resolvePlatformShippingRegionCode([
      countryCodeFromStoreRegion(order.store),
      typeof order.taxCountryCode === 'string' ? order.taxCountryCode : null,
    ]);
    const shippingSettings =
      await this.platformShipping.getPublicSettings(regionCode);
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

    const totalStripeFeeCents = await this.stripeFees.totalProcessingFeeCents({
      chargeId,
      paymentAmountCents: chargeAmountCents,
    });
    const deliveryNetSettlement = this.stripeFees.toTransferMinorUnits(
      deliveryNetBeforeStripe,
      chargeSnap,
    );
    const stripeProcessingFeeShareCents =
      this.stripeFees.allocateProcessingFeeShareCents({
        totalStripeFeeCents,
        paymentAmountCents: chargeAmountCents,
        sliceAmountCents: shipCents,
        maxDeductibleCents: deliveryNetSettlement,
      });
    let transferCents = Math.max(
      0,
      deliveryNetSettlement - stripeProcessingFeeShareCents,
    );

    const remainingOnCharge =
      await this.stripeFees.remainingTransferableCents(chargeId);
    if (remainingOnCharge > 0) {
      transferCents = Math.min(transferCents, remainingOnCharge);
    } else {
      const settlementCap =
        chargeSnap?.settlementAmountCents &&
        chargeSnap.settlementAmountCents > 0
          ? chargeSnap.settlementAmountCents
          : this.stripeFees.toTransferMinorUnits(chargeAmountCents, chargeSnap);
      if (settlementCap > 0) {
        transferCents = Math.min(transferCents, settlementCap);
      }
    }

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

    const transferCurrency = await this.connectTransferCurrency(chargeId);

    const existingDelivery = await this.findExistingConnectTransfer({
      orderId: args.orderId,
      transferKind: 'delivery_shipping',
      transferGroup: parentId || undefined,
      destination: accountId,
      chargeId,
    });
    if (existingDelivery) {
      const existingCents = Math.max(
        0,
        Math.round(Number(existingDelivery.amount ?? 0)),
      );
      await this.orderModel.updateOne(
        { _id: args.orderId },
        {
          $set: {
            stripeDeliveryTransferId: existingDelivery.id,
            stripeDeliveryTransferAmountCents: existingCents,
            stripeDeliveryProcessingFeeCents: stripeProcessingFeeShareCents,
          },
        },
      );
      this.logger.log(
        `Connect delivery transfer reconciled ${existingDelivery.id}: ${existingCents} → ${accountId} (order ${args.orderId})`,
      );
      return {
        transferred: true,
        transferId: existingDelivery.id,
        transferCents: existingCents,
        stripeProcessingFeeCents: stripeProcessingFeeShareCents,
        grossShipCents: shipCents,
        skippedReason: 'already_transferred',
      };
    }

    try {
      const transfer = await this.createConnectTransfer({
        kind: 'delivery',
        orderId: args.orderId,
        amountCents: transferCents,
        currency: transferCurrency,
        destination: accountId,
        chargeId,
        transferGroup: parentId || undefined,
        transferKind: 'delivery_shipping',
        metadata: {
          orderId: args.orderId,
          agentUserId: agentId,
          platform: 'wise-eat',
          transferKind: 'delivery_shipping',
          stripeProcessingFeeCents: String(stripeProcessingFeeShareCents),
          grossShipCents: String(shipCents),
        },
      });

      const savedCents = Math.max(
        0,
        Math.round(Number(transfer.amount ?? transferCents)),
      );
      await this.orderModel.updateOne(
        { _id: args.orderId },
        {
          $set: {
            stripeDeliveryTransferId: transfer.id,
            stripeDeliveryTransferAmountCents: savedCents,
            stripeDeliveryProcessingFeeCents: stripeProcessingFeeShareCents,
          },
        },
      );

      this.logger.log(
        `Connect delivery transfer ${transfer.id}: ${savedCents} ${transferCurrency} → ${accountId} (order ${args.orderId}, stripeFee=${
          stripeProcessingFeeShareCents
        })`,
      );

      return {
        transferred: true,
        transferId: transfer.id,
        transferCents: savedCents,
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
   * Verse le pourboire livreur au livreur assigné (100 % moins part frais Stripe).
   */
  async transferDeliveryTipForCompletedOrder(args: {
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
        'shouldShip assignedDeliveryUser stripeParentPaymentId deliveryTipCents deliveryTipStatus stripeDeliveryTipTransferId stripeDeliveryTipTransferAmountCents status',
      )
      .lean()
      .exec();
    if (!order) {
      return { ...empty, skippedReason: 'order_not_found' };
    }
    if (!order.shouldShip) {
      return { ...empty, skippedReason: 'not_delivery_order' };
    }

    const tipCents = Math.max(0, Math.round(Number(order.deliveryTipCents) || 0));
    if (tipCents < 1) {
      return { ...empty, skippedReason: 'no_tip_amount' };
    }

    const tipStatus = String(order.deliveryTipStatus ?? 'none');
    if (tipStatus === 'transferred') {
      return {
        transferred: true,
        transferId: order.stripeDeliveryTipTransferId,
        transferCents: order.stripeDeliveryTipTransferAmountCents ?? 0,
        stripeProcessingFeeCents: 0,
        grossShipCents: tipCents,
        skippedReason: 'already_transferred',
      };
    }
    if (tipStatus === 'refunded') {
      return { ...empty, grossShipCents: tipCents, skippedReason: 'tip_not_payable' };
    }
    // `none` + tipCents>0 (legacy) : on verse quand même (déjà filtré tipCents>=1).

    if (order.stripeDeliveryTipTransferId) {
      return {
        transferred: true,
        transferId: order.stripeDeliveryTipTransferId,
        transferCents: order.stripeDeliveryTipTransferAmountCents ?? 0,
        stripeProcessingFeeCents: 0,
        grossShipCents: tipCents,
        skippedReason: 'already_transferred',
      };
    }

    const agentId = order.assignedDeliveryUser
      ? String(order.assignedDeliveryUser)
      : '';
    if (!agentId) {
      return { ...empty, grossShipCents: tipCents, skippedReason: 'no_assigned_delivery_agent' };
    }

    const { accountId, agentReady } = await this.agentConnectAccountId(agentId);
    if (!agentReady || !accountId) {
      return {
        ...empty,
        grossShipCents: tipCents,
        skippedReason: 'delivery_connect_onboarding_incomplete',
      };
    }

    const parentId = String(order.stripeParentPaymentId ?? '').trim();
    const chargeId = parentId ? await this.resolveChargeId(parentId) : null;
    if (!chargeId) {
      return {
        ...empty,
        grossShipCents: tipCents,
        skippedReason: 'charge_unresolved',
      };
    }

    const paymentAmountCents = await this.stripeFees.paymentTotalCentsForParent(
      parentId,
      args.paymentTotalCents ?? tipCents,
    );
    const chargeSnap = await this.stripeFees.chargeFeeSnapshot(chargeId);
    const chargeAmountCents = Math.max(
      paymentAmountCents,
      chargeSnap?.amountCents ?? 0,
    );
    const totalStripeFeeCents = await this.stripeFees.totalProcessingFeeCents({
      chargeId,
      paymentAmountCents: chargeAmountCents,
    });
    const tipSettlement = this.stripeFees.toTransferMinorUnits(
      tipCents,
      chargeSnap,
    );
    const stripeProcessingFeeShareCents =
      this.stripeFees.allocateProcessingFeeShareCents({
        totalStripeFeeCents,
        paymentAmountCents: chargeAmountCents,
        sliceAmountCents: tipCents,
        maxDeductibleCents: tipSettlement,
      });
    let transferCents = Math.max(0, tipSettlement - stripeProcessingFeeShareCents);

    const remainingOnCharge =
      await this.stripeFees.remainingTransferableCents(chargeId);
    if (remainingOnCharge > 0) {
      transferCents = Math.min(transferCents, remainingOnCharge);
    } else {
      const settlementCap =
        chargeSnap?.settlementAmountCents &&
        chargeSnap.settlementAmountCents > 0
          ? chargeSnap.settlementAmountCents
          : this.stripeFees.toTransferMinorUnits(chargeAmountCents, chargeSnap);
      if (settlementCap > 0) {
        transferCents = Math.min(transferCents, settlementCap);
      }
    }

    if (transferCents < 1) {
      await this.orderModel.updateOne(
        { _id: args.orderId },
        {
          $set: {
            stripeDeliveryTipProcessingFeeCents: stripeProcessingFeeShareCents,
            stripeDeliveryTipTransferAmountCents: 0,
            deliveryTipStatus: 'transferred',
          },
        },
      );
      return {
        transferred: false,
        transferCents: 0,
        stripeProcessingFeeCents: stripeProcessingFeeShareCents,
        grossShipCents: tipCents,
        skippedReason: 'transfer_amount_zero_after_stripe_fee',
      };
    }

    const transferCurrency = await this.connectTransferCurrency(chargeId);

    const existingTip = await this.findExistingConnectTransfer({
      orderId: args.orderId,
      transferKind: 'delivery_tip',
      transferGroup: parentId || undefined,
      destination: accountId,
      chargeId,
    });
    if (existingTip) {
      const existingCents = Math.max(
        0,
        Math.round(Number(existingTip.amount ?? 0)),
      );
      await this.orderModel.updateOne(
        { _id: args.orderId },
        {
          $set: {
            stripeDeliveryTipTransferId: existingTip.id,
            stripeDeliveryTipTransferAmountCents: existingCents,
            stripeDeliveryTipProcessingFeeCents: stripeProcessingFeeShareCents,
            deliveryTipStatus: 'transferred',
          },
        },
      );
      this.logger.log(
        `Connect delivery tip transfer reconciled ${existingTip.id}: ${existingCents} → ${accountId} (order ${args.orderId})`,
      );
      return {
        transferred: true,
        transferId: existingTip.id,
        transferCents: existingCents,
        stripeProcessingFeeCents: stripeProcessingFeeShareCents,
        grossShipCents: tipCents,
        skippedReason: 'already_transferred',
      };
    }

    try {
      const transfer = await this.createConnectTransfer({
        kind: 'delivery-tip',
        orderId: args.orderId,
        amountCents: transferCents,
        currency: transferCurrency,
        destination: accountId,
        chargeId,
        transferGroup: parentId || undefined,
        transferKind: 'delivery_tip',
        metadata: {
          orderId: args.orderId,
          agentUserId: agentId,
          platform: 'wise-eat',
          transferKind: 'delivery_tip',
          stripeProcessingFeeCents: String(stripeProcessingFeeShareCents),
          grossTipCents: String(tipCents),
        },
      });

      const savedCents = Math.max(
        0,
        Math.round(Number(transfer.amount ?? transferCents)),
      );
      await this.orderModel.updateOne(
        { _id: args.orderId },
        {
          $set: {
            stripeDeliveryTipTransferId: transfer.id,
            stripeDeliveryTipTransferAmountCents: savedCents,
            stripeDeliveryTipProcessingFeeCents: stripeProcessingFeeShareCents,
            deliveryTipStatus: 'transferred',
          },
        },
      );

      this.logger.log(
        `Connect delivery tip transfer ${transfer.id}: ${savedCents} ${transferCurrency} → ${accountId} (order ${args.orderId})`,
      );

      return {
        transferred: true,
        transferId: transfer.id,
        transferCents: savedCents,
        stripeProcessingFeeCents: stripeProcessingFeeShareCents,
        grossShipCents: tipCents,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `Connect delivery tip transfer failed order ${args.orderId}: ${msg}`,
      );
      return {
        transferred: false,
        transferCents,
        stripeProcessingFeeCents: stripeProcessingFeeShareCents,
        grossShipCents: tipCents,
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
  }): Promise<{
    reversed: boolean;
    reversalId?: string;
    reversalCents: number;
  }> {
    if (!this.transfersEnabled()) {
      return { reversed: false, reversalCents: 0 };
    }
    if (!Types.ObjectId.isValid(args.orderId)) {
      return { reversed: false, reversalCents: 0 };
    }

    const order = await this.orderModel
      .findById(args.orderId)
      .select(
        'stripeTransferId stripeTransferAmountCents stripeTransferReversalId stripeTransferReversalAmountCents stripeChargedGoodsCents stripeChargedShipCents stripeDeliveryTransferId stripeDeliveryTransferAmountCents stripeDeliveryTransferReversalAmountCents deliveryTipCents deliveryTipStatus stripeDeliveryTipTransferId stripeDeliveryTipTransferAmountCents stripeDeliveryTipTransferReversalAmountCents',
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

    if (order.stripeDeliveryTipTransferId) {
      const tipRev = await this.reverseSingleTransfer({
        transferId: order.stripeDeliveryTipTransferId,
        transferCents: Number(order.stripeDeliveryTipTransferAmountCents ?? 0),
        alreadyReversedCents: Number(
          order.stripeDeliveryTipTransferReversalAmountCents ?? 0,
        ),
        orderId: args.orderId,
        refundCents: args.customerRefundCents,
        grossCents: Math.max(0, Math.round(Number(order.deliveryTipCents) || 0)),
        idempotencySuffix: 'delivery_tip',
        orderFieldPrefix: 'stripeDeliveryTipTransfer',
        forceFullReversal: true,
      });
      totalReversed += tipRev.reversalCents;
      lastReversalId = tipRev.reversalId ?? lastReversalId;
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
    orderFieldPrefix:
      | 'stripeTransfer'
      | 'stripeDeliveryTransfer'
      | 'stripeDeliveryTipTransfer';
    forceFullReversal?: boolean;
  }): Promise<{
    reversed: boolean;
    reversalId?: string;
    reversalCents: number;
  }> {
    const transferCents = Math.max(0, args.transferCents);
    const alreadyReversed = Math.max(0, args.alreadyReversedCents);
    const remaining = transferCents - alreadyReversed;
    if (remaining < 1) {
      return { reversed: false, reversalCents: 0 };
    }

    const gross = Math.max(0, args.grossCents);
    const refundCents = Math.max(1, Math.round(args.refundCents));

    let reversalCents = remaining;
    if (!args.forceFullReversal && gross > 0 && refundCents < gross) {
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
            platform: 'wise-eat',
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
          : args.orderFieldPrefix === 'stripeDeliveryTransfer'
            ? {
                stripeDeliveryTransferReversalId: reversal.id,
                stripeDeliveryTransferReversalAmountCents: newReversedTotal,
              }
            : {
                stripeDeliveryTipTransferReversalId: reversal.id,
                stripeDeliveryTipTransferReversalAmountCents: newReversedTotal,
              };

      await this.orderModel.updateOne(
        { _id: args.orderId },
        { $set: reversalField },
      );

      this.logger.log(
        `Connect transfer reversal ${reversal.id}: ${
          reversalCents / 100
        } CAD on ${args.transferId} (${args.idempotencySuffix})`,
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
