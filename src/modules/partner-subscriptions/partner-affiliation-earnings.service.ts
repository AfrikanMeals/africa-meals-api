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
} from './partner-plan-fee.util';
import {
  computePartnerEarningListTotals,
  mapPartnerEarningToListItem,
  type PartnerEarningListLean,
} from './partner-earning-list.util';
import { PartnerSubscriptionsService } from './partner-subscriptions.service';

type StripeClient = InstanceType<typeof Stripe>;

function normalizeReferralCode(raw: string): string {
  // Compat attach legacy (longueur souple) — signup utilise normalizePartnerReferralCode.
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 16);
}

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
    private readonly partnerSubs: PartnerSubscriptionsService,
    private readonly config: ConfigService,
  ) {}

  private stripe(): StripeClient | null {
    const key = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
    if (!key) return null;
    return new Stripe(key);
  }

  /**
   * Lookup public d’un code referral APPROVED — pas d’identité Partner exposée.
   */
  async lookupPublicReferralCode(raw: string | null | undefined): Promise<{
    valid: boolean;
    code: string | null;
  }> {
    const code = normalizePartnerReferralCode(raw);
    if (!code) {
      return { valid: false, code: null };
    }
    const app = await this.applicationModel
      .findOne({ referralCode: code, status: 'APPROVED' })
      .select('_id')
      .lean()
      .exec();
    return { valid: !!app, code };
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
   * Lie le compte courant à un Partner via code referral (une seule fois).
   */
  async attachReferral(user: UserModel, dto: AttachPartnerReferralDto) {
    if (user.type === UserTypeEnum.PARTNER || user.type === UserTypeEnum.ADMIN) {
      throw new ForbiddenException('partner_referral_not_for_partner');
    }
    const uid = String(user._id);
    const existing = await this.userModel
      .findById(uid)
      .select('referredByPartnerUserId')
      .lean()
      .exec();
    if ((existing as { referredByPartnerUserId?: Types.ObjectId })
      ?.referredByPartnerUserId) {
      throw new BadRequestException('partner_referral_already_set');
    }
    const code = normalizeReferralCode(dto.referralCode);
    if (code.length < 3) {
      throw new BadRequestException('partner_referral_code_invalid');
    }
    const app = await this.applicationModel
      .findOne({
        referralCode: code,
        status: 'APPROVED',
      })
      .select('user referralCode')
      .lean()
      .exec();
    if (!app?.user) {
      throw new NotFoundException('partner_referral_code_not_found');
    }
    const partnerUserId = String(app.user);
    if (partnerUserId === uid) {
      throw new BadRequestException('partner_referral_self');
    }
    await this.userModel
      .updateOne(
        { _id: new Types.ObjectId(uid) },
        {
          $set: {
            referredByPartnerUserId: new Types.ObjectId(partnerUserId),
            referredByPartnerCode: code,
          },
        },
      )
      .exec();
    return { ok: true, referredByPartnerUserId: partnerUserId, code };
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
    const amountCents = Math.round(Number(doc.commissionAmount) * 100);
    if (amountCents <= 0) return;
    try {
      const transfer = await stripe.transfers.create({
        amount: amountCents,
        currency: String(doc.currency || 'cad').toLowerCase(),
        destination: accountId,
        metadata: {
          kind: 'partner_affiliation_earning',
          earningId: String(doc._id),
          axis: doc.axis,
          sourceType: doc.sourceType,
          sourceId: doc.sourceId,
        },
      });
      await this.earningModel
        .updateOne(
          { _id: doc._id },
          {
            $set: {
              status: 'TRANSFERRED',
              stripeTransferId: transfer.id,
            },
          },
        )
        .exec();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(
        `Partner earning transfer failed ${String(doc._id)}: ${msg}`,
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
    };
  }
}
