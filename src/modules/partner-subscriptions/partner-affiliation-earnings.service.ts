import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { PartnerApplicationModel } from '@schemas/partner-application.schema';
import {
  PartnerEarningAxis,
  PartnerEarningDocument,
  PartnerEarningModel,
} from '@schemas/partner-earning.schema';
import { PartnerSubscriptionPlanModel } from '@schemas/partner-subscription-plan.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import Stripe = require('stripe');
import { normalizePartnerReferralCode } from '@modules/partner-applications/partner-referral-code.util';
import { AttachPartnerReferralDto } from './dto/partner-subscription-plan.dto';
import {
  computePartnerPlanFeeAmount,
  findPartnerPlanRegionRow,
  normalizePartnerPlanPayoutDelayDays,
} from './partner-plan-fee.util';
import {
  computePartnerEarningListTotals,
  computePartnerEarningTotalsByCurrency,
  mapPartnerEarningToListItem,
  type PartnerEarningListLean,
} from './partner-earning-list.util';
import { evaluatePartnerReferralAttach } from './partner-referral-admin-attach.util';
import { isPartnerReferralCodeEligible } from './partner-referral-eligibility.util';
import {
  accumulatePartnerEarningReprocessOutcome,
  classifyPartnerEarningReprocessOutcome,
  emptyPartnerEarningReprocessCounters,
  isPartnerEarningFailedStatus,
  partnerEarningTransferIdempotencyKey,
  type PartnerEarningReprocessCounters,
} from './partner-earning-reprocess.util';
import {
  buildPartnerReferrersBundle,
  type PartnerReferrerUserLean,
} from './partner-referrers-list.util';
import { PartnerSubscriptionsService } from './partner-subscriptions.service';
import { StripeChargeFeeService } from '@modules/billing/stripe/stripe-charge-fee.service';
import { OrderModel } from '@schemas/order.schema';
import {
  parsePartnerEarningOrderId,
  pickPlatformAvailableMinor,
  resolvePartnerEarningTransferSpec,
  type PlatformBalanceRow,
} from './partner-earning-transfer-amount.util';
import { toStripeMinorUnits } from '@utils/stripe-currency-amount.util';

type StripeClient = InstanceType<typeof Stripe>;

/**
 * Attribution referral + ledger gains affiliation + payout fee Partner.
 */
@Injectable()
export class PartnerAffiliationEarningsService {
  private readonly logger = new Logger(PartnerAffiliationEarningsService.name);

  constructor(
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    @InjectModel(PartnerApplicationModel.name)
    private readonly applicationModel: Model<PartnerApplicationModel>,
    @InjectModel(PartnerEarningModel.name)
    private readonly earningModel: Model<PartnerEarningDocument>,
    @InjectModel(PartnerSubscriptionPlanModel.name)
    private readonly planModel: Model<PartnerSubscriptionPlanModel>,
    @InjectModel(OrderModel.name)
    private readonly orderModel: Model<OrderModel>,
    private readonly partnerSubs: PartnerSubscriptionsService,
    private readonly stripeFees: StripeChargeFeeService,
    private readonly config: ConfigService,
  ) {}

  private stripe(): StripeClient | null {
    const key = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
    if (!key) return null;
    return new Stripe(key);
  }

  /**
   * Résout un Partner actif par code referral (sans filtre status APPROVED seul).
   * Titulaire doit être `UserTypeEnum.PARTNER` ; candidature SUSPENDED exclue.
   */
  private async resolveActivePartnerByReferralCode(
    raw: string | null | undefined,
  ): Promise<{ partnerUserId: string; code: string } | null> {
    const code = normalizePartnerReferralCode(raw);
    if (!code) return null;
    const app = await this.applicationModel
      .findOne({ referralCode: code })
      .select('user referralCode status')
      .lean()
      .exec();
    if (!app?.user) return null;
    const partnerUser = await this.userModel
      .findById(app.user)
      .select('type')
      .lean()
      .exec();
    if (
      !isPartnerReferralCodeEligible({
        partnerUserType: (partnerUser as { type?: string } | null)?.type,
        applicationStatus: (app as { status?: string }).status,
      })
    ) {
      return null;
    }
    return { partnerUserId: String(app.user), code };
  }

  /**
   * Lookup public d’un code referral — pas d’identité Partner exposée.
   */
  async lookupPublicReferralCode(raw: string | null | undefined): Promise<{
    valid: boolean;
    code: string | null;
  }> {
    const code = normalizePartnerReferralCode(raw);
    if (!code) {
      return { valid: false, code: null };
    }
    const hit = await this.resolveActivePartnerByReferralCode(code);
    return { valid: !!hit, code };
  }

  /**
   * Attache un code à l’inscription / session — erreurs métier ignorées (ne bloque pas le signup).
   */
  async tryAttachReferralOnSignup(
    user: UserModel,
    rawCode: string | null | undefined,
  ): Promise<boolean> {
    const code = normalizePartnerReferralCode(rawCode);
    if (!code) return false;
    try {
      await this.attachReferral(user, { referralCode: code });
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[signup referral] skip user=${String(user._id)} code=${code}: ${msg}`,
      );
      return false;
    }
  }

  /**
   * Applique le lien filleul → Partner après validation métier.
   * Shared self-service + admin (force override).
   */
  private async applyPartnerReferralAttach(args: {
    targetUserId: string;
    targetType: string;
    existingPartnerUserId?: string | null;
    referralCode: string;
    force: boolean;
  }): Promise<{
    ok: true;
    referredByPartnerUserId: string;
    code: string;
    overridden: boolean;
    previousCode: string | null;
  }> {
    // Même règle que le lookup landing (PARTNER actif, pas seulement APPROVED).
    const resolved = await this.resolveActivePartnerByReferralCode(
      args.referralCode,
    );
    if (!resolved) {
      throw new NotFoundException('partner_referral_code_not_found');
    }
    const { code, partnerUserId } = resolved;
    const decision = evaluatePartnerReferralAttach({
      targetType: args.targetType,
      targetUserId: args.targetUserId,
      partnerUserId,
      existingPartnerUserId: args.existingPartnerUserId,
      force: args.force,
    });
    // Discriminant littéral `ok === false` (évite TS2339 sur `reason`).
    if (decision.ok === false) {
      const { reason } = decision;
      if (reason === 'partner_referral_not_for_partner') {
        throw new ForbiddenException(reason);
      }
      throw new BadRequestException(reason);
    }
    const previousCode = await this.readReferredByPartnerCode(
      args.targetUserId,
    );
    await this.userModel
      .updateOne(
        { _id: new Types.ObjectId(args.targetUserId) },
        {
          $set: {
            referredByPartnerUserId: new Types.ObjectId(partnerUserId),
            referredByPartnerCode: code,
          },
        },
      )
      .exec();
    return {
      ok: true,
      referredByPartnerUserId: partnerUserId,
      code,
      overridden: decision.willOverride,
      previousCode,
    };
  }

  /** Lit le code referral déjà stocké (affichage override admin). */
  private async readReferredByPartnerCode(
    userId: string,
  ): Promise<string | null> {
    const row = await this.userModel
      .findById(userId)
      .select('referredByPartnerCode')
      .lean()
      .exec();
    return normalizePartnerReferralCode(
      (row as { referredByPartnerCode?: string } | null)?.referredByPartnerCode,
    );
  }

  /**
   * Lie le compte courant à un Partner via code referral (une seule fois).
   */
  async attachReferral(user: UserModel, dto: AttachPartnerReferralDto) {
    const uid = String(user._id);
    const existing = await this.userModel
      .findById(uid)
      .select('type referredByPartnerUserId')
      .lean()
      .exec();
    if (!existing) {
      throw new NotFoundException('user_not_found');
    }
    const existingPartnerId = (
      existing as { referredByPartnerUserId?: Types.ObjectId }
    ).referredByPartnerUserId;
    return this.applyPartnerReferralAttach({
      targetUserId: uid,
      targetType: String(
        (existing as { type?: string }).type ?? user.type ?? '',
      ),
      existingPartnerUserId: existingPartnerId
        ? String(existingPartnerId)
        : null,
      referralCode: dto.referralCode,
      // Self-service : jamais d’écrasement (invariant une seule fois).
      force: false,
    });
  }

  /**
   * Admin — lie un Client / Vendeur / Livreur à un Partner (force = override).
   */
  async attachReferralForUserAdmin(
    targetUserId: string,
    dto: { referralCode: string; force?: boolean },
  ): Promise<{
    ok: true;
    referredByPartnerUserId: string;
    code: string;
    overridden: boolean;
    previousCode: string | null;
  }> {
    const uid = String(targetUserId ?? '').trim();
    if (!Types.ObjectId.isValid(uid)) {
      throw new BadRequestException('invalid_user_id');
    }
    const existing = await this.userModel
      .findById(uid)
      .select('type referredByPartnerUserId referredByPartnerCode')
      .lean()
      .exec();
    if (!existing) {
      throw new NotFoundException('user_not_found');
    }
    const existingPartnerId = (
      existing as { referredByPartnerUserId?: Types.ObjectId }
    ).referredByPartnerUserId;
    return this.applyPartnerReferralAttach({
      targetUserId: uid,
      targetType: String((existing as { type?: string }).type ?? ''),
      existingPartnerUserId: existingPartnerId
        ? String(existingPartnerId)
        : null,
      referralCode: dto.referralCode,
      force: dto.force === true,
    });
  }

  /**
   * Résout le Partner à créditer pour une commande (priorité client → owner store → livreur).
   */
  async resolveAttributionPartnerUserId(args: {
    customerUserId?: string | null;
    storeOwnerUserId?: string | null;
    courierUserId?: string | null;
  }): Promise<string | null> {
    const candidates = [
      args.customerUserId,
      args.storeOwnerUserId,
      args.courierUserId,
    ]
      .map((id) => String(id ?? '').trim())
      .filter((id) => Types.ObjectId.isValid(id));
    if (!candidates.length) return null;
    const users = await this.userModel
      .find({ _id: { $in: candidates.map((id) => new Types.ObjectId(id)) } })
      .select('_id referredByPartnerUserId')
      .lean()
      .exec();
    const byId = new Map(
      users.map((u) => [
        String(u._id),
        u.referredByPartnerUserId
          ? String(u.referredByPartnerUserId)
          : null,
      ]),
    );
    for (const id of candidates) {
      const partnerId = byId.get(id);
      if (partnerId) return partnerId;
    }
    return null;
  }

  private commissionFieldForAxis(
    axis: PartnerEarningAxis,
  ):
    | 'customerOrderCommissionsByRegion'
    | 'vendorSalesCommissionsByRegion'
    | 'courierGainsCommissionsByRegion' {
    if (axis === 'vendor_sales') return 'vendorSalesCommissionsByRegion';
    if (axis === 'courier_gains') return 'courierGainsCommissionsByRegion';
    return 'customerOrderCommissionsByRegion';
  }

  /**
   * Frais payout Connect Partner depuis le plan actif (sinon null → caller global).
   */
  async resolvePayoutFeeRowForPartner(partnerUserId: string, regionCode?: string | null) {
    const sub = await this.partnerSubs.findActiveSubscriptionForOwner(
      partnerUserId,
    );
    if (!sub?.plan) return null;
    const plan = await this.planModel.findById(sub.plan).lean().exec();
    if (!plan) return null;
    return (
      findPartnerPlanRegionRow(
        (plan as { payoutFeesByRegion?: { regionCode?: string }[] })
          .payoutFeesByRegion,
        regionCode,
      ) ?? null
    );
  }

  /**
   * Délai versement (jours) du plan actif Partner — 0 = instantané.
   * Sans abo actif → 0 (comportement safe / instant).
   */
  async resolvePayoutDelayDaysForPartner(
    partnerUserId: string,
  ): Promise<number> {
    const uid = String(partnerUserId ?? '').trim();
    if (!uid || !Types.ObjectId.isValid(uid)) return 0;
    const sub = await this.partnerSubs.findActiveSubscriptionForOwner(uid);
    if (!sub?.plan) return 0;
    const plan = await this.planModel
      .findById(sub.plan)
      .select('payoutDelayDays')
      .lean()
      .exec();
    return normalizePartnerPlanPayoutDelayDays(
      (plan as { payoutDelayDays?: number } | null)?.payoutDelayDays,
    );
  }

  async recordEarning(args: {
    partnerUserId: string;
    axis: PartnerEarningAxis;
    sourceType: string;
    sourceId: string;
    regionCode?: string | null;
    baseAmount: number;
    currency?: string;
  }): Promise<{ created: boolean; earningId?: string; amount?: number }> {
    const partnerUserId = args.partnerUserId.trim();
    if (!Types.ObjectId.isValid(partnerUserId)) {
      return { created: false };
    }
    const sub = await this.partnerSubs.findActiveSubscriptionForOwner(
      partnerUserId,
    );
    if (!sub?.plan) {
      this.logger.debug(
        `No active partner plan for ${partnerUserId} — skip earning`,
      );
      return { created: false };
    }
    const plan = await this.planModel.findById(sub.plan).lean().exec();
    if (!plan) return { created: false };

    const field = this.commissionFieldForAxis(args.axis);
    const rows = (plan as Record<string, unknown>)[field] as
      | { regionCode?: string }[]
      | undefined;
    const row = findPartnerPlanRegionRow(rows, args.regionCode);
    const fee = computePartnerPlanFeeAmount(row as never, args.baseAmount);
    if (fee.amount <= 0) return { created: false };

    const currency =
      String(args.currency ?? plan.currency ?? 'CAD')
        .trim()
        .toUpperCase() || 'CAD';

    try {
      const doc = await this.earningModel.create({
        partnerUserId: new Types.ObjectId(partnerUserId),
        planId: plan._id,
        axis: args.axis,
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        regionCode: String(args.regionCode ?? '')
          .trim()
          .toUpperCase(),
        baseAmount: Math.max(0, Number(args.baseAmount) || 0),
        commissionAmount: fee.amount,
        currency,
        feeMode: fee.feeMode,
        feeFixed: fee.feeFixed,
        feePercent: fee.feePercent,
        status: 'PENDING',
      });
      await this.tryTransferEarning(doc);
      return {
        created: true,
        earningId: String(doc._id),
        amount: fee.amount,
      };
    } catch (e) {
      // Duplicate key = déjà comptabilisé
      if (
        e &&
        typeof e === 'object' &&
        'code' in e &&
        (e as { code?: number }).code === 11000
      ) {
        return { created: false };
      }
      throw e;
    }
  }

  /**
   * Solde plateforme (toutes devises) — pour choisir ledger vs settlement CAD.
   */
  private async loadPlatformAvailableBalance(
    stripe: StripeClient,
  ): Promise<PlatformBalanceRow[]> {
    try {
      const balance = await stripe.balance.retrieve();
      return (balance.available ?? []).map((row) => ({
        currency: String(row.currency ?? 'cad'),
        amountMinor: Math.max(0, Math.round(Number(row.amount) || 0)),
      }));
    } catch (e) {
      this.logger.warn(
        `Platform balance retrieve failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
      return [];
    }
  }

  /**
   * Taux charge → settlement via la commande liée (même pipeline vendeur Connect).
   */
  private async resolveLedgerToSettlementRate(
    doc: PartnerEarningDocument,
  ): Promise<number | null> {
    const orderId = parsePartnerEarningOrderId(String(doc.sourceId ?? ''));
    if (!orderId) return null;
    const order = await this.orderModel
      .findById(orderId)
      .select('stripeParentPaymentId')
      .lean()
      .exec();
    const parentId = String(
      (order as { stripeParentPaymentId?: string } | null)
        ?.stripeParentPaymentId ?? '',
    ).trim();
    if (!parentId) return null;
    const chargeId = await this.stripeFees.resolveChargeId(parentId);
    if (!chargeId) return null;
    const snap = await this.stripeFees.chargeFeeSnapshot(chargeId);
    const rate = Number(snap?.exchangeRate);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  }

  private async tryTransferEarning(doc: PartnerEarningDocument): Promise<void> {
    const stripe = this.stripe();
    if (!stripe) return;
    const partner = await this.userModel
      .findById(doc.partnerUserId)
      .select('stripeConnectAccountId stripeConnectPayoutsEnabled type')
      .lean()
      .exec();
    const accountId = String(
      (partner as { stripeConnectAccountId?: string })
        ?.stripeConnectAccountId ?? '',
    ).trim();
    if (
      !accountId ||
      (partner as { type?: string })?.type !== UserTypeEnum.PARTNER
    ) {
      return;
    }

    const ledgerCurrency = String(doc.currency || 'CAD');
    const settlementCurrency =
      this.config.get<string>('STRIPE_CONNECT_TRANSFER_CURRENCY')?.trim() ||
      'cad';
    const platformAvailable = await this.loadPlatformAvailableBalance(stripe);
    const ledgerMinor = toStripeMinorUnits(
      Number(doc.commissionAmount) || 0,
      ledgerCurrency,
    );
    const ledgerAvail = pickPlatformAvailableMinor(
      platformAvailable,
      ledgerCurrency,
    );
    // FX charge→settlement seulement si le solde ledger (ex. XAF) est insuffisant.
    const ledgerToSettlementRate =
      ledgerAvail >= ledgerMinor
        ? null
        : await this.resolveLedgerToSettlementRate(doc);

    const spec = resolvePartnerEarningTransferSpec({
      ledgerAmountMajor: Number(doc.commissionAmount) || 0,
      ledgerCurrency,
      platformAvailable,
      settlementCurrency,
      ledgerToSettlementRate,
    });

    const earningId = String(doc._id);
    if (spec.ok === false) {
      const msg = `Partner earning transfer blocked ${earningId}: ${spec.reason}`;
      this.logger.warn(msg);
      await this.earningModel
        .updateOne(
          { _id: doc._id },
          { $set: { status: 'FAILED', failureReason: msg.slice(0, 500) } },
        )
        .exec();
      return;
    }

    try {
      if (spec.mode === 'settlement_fx') {
        this.logger.log(
          `Partner earning FX ${earningId}: ${ledgerCurrency} → ${spec.currency} ` +
            `minor=${spec.amountMinor}`,
        );
      }
      const transfer = await stripe.transfers.create(
        {
          amount: spec.amountMinor,
          currency: spec.currency,
          destination: accountId,
          metadata: {
            kind: 'partner_affiliation_earning',
            earningId,
            axis: doc.axis,
            sourceType: doc.sourceType,
            sourceId: doc.sourceId,
            ledgerCurrency: ledgerCurrency.toLowerCase(),
            transferMode: spec.mode,
          },
        },
        {
          // Devise dans la clé : retry CAD ≠ replay failed XAF.
          idempotencyKey: partnerEarningTransferIdempotencyKey(
            earningId,
            spec.currency,
          ),
        },
      );
      await this.earningModel
        .updateOne(
          { _id: doc._id },
          {
            $set: {
              status: 'TRANSFERRED',
              stripeTransferId: transfer.id,
              failureReason: '',
            },
          },
        )
        .exec();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `Partner earning transfer failed ${earningId}: ${msg}`,
      );
      await this.earningModel
        .updateOne(
          { _id: doc._id },
          { $set: { status: 'FAILED', failureReason: msg.slice(0, 500) } },
        )
        .exec();
    }
  }

  /**
   * Admin — retente tous les earnings FAILED d’un Partner (après Connect prêt).
   * Ne crée pas de doublon ledger ; Idempotency-Key Stripe par earningId.
   */
  async reprocessFailedEarningsForPartner(
    partnerUserId: string,
    opts?: { limit?: number },
  ): Promise<PartnerEarningReprocessCounters> {
    const uid = String(partnerUserId ?? '').trim();
    if (!uid || !Types.ObjectId.isValid(uid)) {
      throw new BadRequestException('partner_earnings_user_invalid');
    }

    const partner = await this.userModel
      .findById(uid)
      .select('stripeConnectAccountId type')
      .lean()
      .exec();
    if (!partner) {
      throw new NotFoundException('partner_profile_user_not_found');
    }
    const accountId = String(
      (partner as { stripeConnectAccountId?: string })
        .stripeConnectAccountId ?? '',
    ).trim();
    const hadConnect =
      accountId.length > 0 &&
      (partner as { type?: string }).type === UserTypeEnum.PARTNER;
    if (!hadConnect) {
      throw new BadRequestException('partner_connect_not_ready');
    }

    const lim = Math.min(
      200,
      Math.max(1, Math.floor(Number(opts?.limit) || 100)),
    );
    const failed = await this.earningModel
      .find({
        partnerUserId: new Types.ObjectId(uid),
        status: 'FAILED',
      })
      .sort({ createdAt: 1 })
      .limit(lim)
      .exec();

    let counters = emptyPartnerEarningReprocessCounters();
    for (const doc of failed) {
      if (!isPartnerEarningFailedStatus(doc.status)) {
        counters = accumulatePartnerEarningReprocessOutcome(
          counters,
          'skipped',
        );
        continue;
      }
      // Remettre en file avant retry (échec précédent laissait FAILED).
      doc.status = 'PENDING';
      doc.failureReason = undefined;
      await doc.save();
      await this.tryTransferEarning(doc);
      const fresh = await this.earningModel
        .findById(doc._id)
        .select('status')
        .lean()
        .exec();
      const outcome = classifyPartnerEarningReprocessOutcome({
        afterStatus: String(
          (fresh as { status?: string } | null)?.status ?? doc.status,
        ),
        hadConnectAccount: true,
      });
      counters = accumulatePartnerEarningReprocessOutcome(counters, outcome);
    }
    return counters;
  }

  /**
   * Hook commande : axes customer_order + vendor_sales.
   */
  async onOrderSettled(args: {
    orderId: string;
    customerUserId?: string | null;
    storeOwnerUserId?: string | null;
    courierUserId?: string | null;
    regionCode?: string | null;
    customerOrderBase: number;
    vendorSalesBase: number;
    currency?: string;
    partnerAttributionUserId?: string | null;
  }): Promise<void> {
    const partnerId =
      args.partnerAttributionUserId?.trim() ||
      (await this.resolveAttributionPartnerUserId({
        customerUserId: args.customerUserId,
        storeOwnerUserId: args.storeOwnerUserId,
        courierUserId: args.courierUserId,
      }));
    if (!partnerId) return;

    if (args.customerOrderBase > 0) {
      await this.recordEarning({
        partnerUserId: partnerId,
        axis: 'customer_order',
        sourceType: 'order',
        sourceId: `${args.orderId}:customer_order`,
        regionCode: args.regionCode,
        baseAmount: args.customerOrderBase,
        currency: args.currency,
      });
    }
    if (args.vendorSalesBase > 0) {
      await this.recordEarning({
        partnerUserId: partnerId,
        axis: 'vendor_sales',
        sourceType: 'order',
        sourceId: `${args.orderId}:vendor_sales`,
        regionCode: args.regionCode,
        baseAmount: args.vendorSalesBase,
        currency: args.currency,
      });
    }
  }

  async onCourierEarningSettled(args: {
    orderId: string;
    courierUserId: string;
    driverEarning: number;
    regionCode?: string | null;
    currency?: string;
  }): Promise<void> {
    if (args.driverEarning <= 0) return;
    const partnerId = await this.resolveAttributionPartnerUserId({
      courierUserId: args.courierUserId,
    });
    if (!partnerId) return;
    await this.recordEarning({
      partnerUserId: partnerId,
      axis: 'courier_gains',
      sourceType: 'delivery_earning',
      sourceId: `${args.orderId}:courier_gains`,
      regionCode: args.regionCode,
      baseAmount: args.driverEarning,
      currency: args.currency,
    });
  }

  /**
   * Liste les commissions d’affiliation du Partner connecté (onglet Finance).
   * Cap 200 — volume ledger faible en v1 ; pas de cursor pour l’instant.
   */
  async listMineForPartner(user: UserModel) {
    if (user.type !== UserTypeEnum.PARTNER) {
      throw new ForbiddenException('partner_earnings_partner_only');
    }
    const uid = String(user._id ?? user.id ?? '');
    return this.listEarningsByPartnerUserId(uid);
  }

  /**
   * Ledger par `partnerUserId` — Partner self + admin Collaborations (sans check type).
   */
  async listEarningsByPartnerUserId(partnerUserId: string) {
    const uid = String(partnerUserId ?? '').trim();
    if (!Types.ObjectId.isValid(uid)) {
      throw new BadRequestException('partner_earnings_user_invalid');
    }
    const rows = await this.earningModel
      .find({ partnerUserId: new Types.ObjectId(uid) })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean()
      .exec();
    const items = (rows as PartnerEarningListLean[]).map(
      mapPartnerEarningToListItem,
    );
    return {
      items,
      totals: computePartnerEarningListTotals(items),
      // Breakdown multi-devise pour conversion affichage Partner (client Fawaz).
      totalsByCurrency: computePartnerEarningTotalsByCurrency(items),
    };
  }

  /**
   * Réseau de filleuls + historique gains par axe (portail Partner Référents).
   */
  async listReferrersForPartner(user: UserModel) {
    if (user.type !== UserTypeEnum.PARTNER) {
      throw new ForbiddenException('partner_referrers_partner_only');
    }
    const uid = String(user._id ?? user.id ?? '');
    return this.listReferrersByPartnerUserId(uid);
  }

  /**
   * Référents par Partner userId — self + admin Collaborations (sans check type).
   */
  async listReferrersByPartnerUserId(partnerUserId: string) {
    const uid = String(partnerUserId ?? '').trim();
    if (!Types.ObjectId.isValid(uid)) {
      throw new BadRequestException('partner_referrers_user_invalid');
    }
    const partnerOid = new Types.ObjectId(uid);
    const [users, earnings] = await Promise.all([
      this.userModel
        .find({ referredByPartnerUserId: partnerOid })
        .select('fullName email type referredByPartnerCode createdAt')
        .sort({ createdAt: -1 })
        .limit(500)
        .lean()
        .exec(),
      this.earningModel
        .find({ partnerUserId: partnerOid })
        .sort({ createdAt: -1 })
        .limit(500)
        .lean()
        .exec(),
    ]);
    return buildPartnerReferrersBundle({
      users: users as PartnerReferrerUserLean[],
      earnings: earnings as PartnerEarningListLean[],
    });
  }
}
