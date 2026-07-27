import { normalizePlanRegionOrderCommissions } from '@modules/subscriptions/dto/plan-region-order-commission.dto';
import { normalizePlanRegionPricing } from '@modules/subscriptions/dto/plan-region-pricing.dto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PartnerApplicationModel } from '@schemas/partner-application.schema';
import { PartnerSubscriptionPlanModel } from '@schemas/partner-subscription-plan.schema';
import { PartnerSubscriptionModel } from '@schemas/partner-subscription.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import {
  CreatePartnerSubscriptionPlanDto,
  UpdatePartnerSubscriptionPlanDto,
} from './dto/partner-subscription-plan.dto';
import {
  findPartnerPlanRegionRow,
  normalizePartnerPlanPayoutDelayDays,
  normalizePartnerTrialReminderDays,
} from './partner-plan-fee.util';
import {
  normalizePartnerOperatingRegionCode,
  pickPartnerPricingRegionCode,
} from './partner-pricing-region.util';

function mapFeeRows(rows: unknown) {
  return normalizePlanRegionOrderCommissions(
    Array.isArray(rows) ? (rows as never) : [],
  );
}

function mapPricingRows(rows: unknown) {
  return normalizePlanRegionPricing(
    Array.isArray(rows) ? (rows as never) : [],
  );
}

/** Sérialisation API d’un plan Partner. */
export function mapPartnerSubscriptionPlan(doc: Record<string, unknown>) {
  return {
    id: String(doc._id),
    name: String(doc.name ?? ''),
    description: String(doc.description ?? ''),
    priceMonthly: Number(doc.priceMonthly ?? 0),
    priceYearly: Number(doc.priceYearly ?? 0),
    currency: String(doc.currency ?? 'CAD')
      .trim()
      .toUpperCase() || 'CAD',
    active: doc.active !== false,
    sortOrder: Number(doc.sortOrder ?? 0),
    trialDays: Math.max(0, Number(doc.trialDays ?? 0)),
    // 0 = instantané (défaut plans existants sans champ).
    payoutDelayDays: normalizePartnerPlanPayoutDelayDays(doc.payoutDelayDays),
    trialReminderDays: Array.isArray(doc.trialReminderDays)
      ? doc.trialReminderDays.map((d) => Number(d)).filter((d) => d > 0)
      : [],
    pricingByRegion: mapPricingRows(doc.pricingByRegion),
    customerOrderCommissionsByRegion: mapFeeRows(
      doc.customerOrderCommissionsByRegion,
    ),
    vendorSalesCommissionsByRegion: mapFeeRows(
      doc.vendorSalesCommissionsByRegion,
    ),
    courierGainsCommissionsByRegion: mapFeeRows(
      doc.courierGainsCommissionsByRegion,
    ),
    payoutFeesByRegion: mapFeeRows(doc.payoutFeesByRegion),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

@Injectable()
export class PartnerSubscriptionPlansService {
  constructor(
    @InjectModel(PartnerSubscriptionPlanModel.name)
    private readonly planModel: Model<PartnerSubscriptionPlanModel>,
    @InjectModel(PartnerSubscriptionModel.name)
    private readonly subModel: Model<PartnerSubscriptionModel>,
    @InjectModel(PartnerApplicationModel.name)
    private readonly applicationModel: Model<PartnerApplicationModel>,
  ) {}

  private assertAdmin(user: UserModel) {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
  }

  /**
   * Région d’exercice Partner (candidature) — source de vérité tarifaire.
   */
  async getPartnerOperatingRegionCode(
    userId: string | Types.ObjectId,
  ): Promise<string | null> {
    if (!Types.ObjectId.isValid(String(userId))) return null;
    const app = await this.applicationModel
      .findOne({ user: new Types.ObjectId(String(userId)) })
      .select('region')
      .lean()
      .exec();
    return normalizePartnerOperatingRegionCode(
      (app as { region?: string } | null)?.region,
    );
  }

  /**
   * Région utilisée pour `pricingByRegion` :
   * appCountryCode > candidature.region > hint client.
   */
  async resolvePricingRegionForUser(
    user: UserModel,
    requestedRegion?: string | null,
  ): Promise<string | null> {
    // PARTNER : Pays d’utilisation profil d’abord (évite CAD si candidature CA stale).
    if (user.type === UserTypeEnum.PARTNER) {
      // Fix TS: `user._id` typé unknown sur le modèle Mongoose injecté.
      const operating = await this.getPartnerOperatingRegionCode(
        String(user._id),
      );
      return pickPartnerPricingRegionCode({
        appCountryCode: (user as UserModel & { appCountryCode?: string })
          .appCountryCode,
        partnerOperatingRegion: operating,
        requestedRegion,
      });
    }
    // ADMIN preview catalogue : hint query/body suffisant.
    return pickPartnerPricingRegionCode({
      appCountryCode: null,
      partnerOperatingRegion: null,
      requestedRegion,
    });
  }

  /** Prix effectifs pour une région (repli sur défauts plan). */
  resolvePricingForRegion(
    plan: Record<string, unknown>,
    regionCode?: string | null,
  ) {
    const lookup = normalizePartnerOperatingRegionCode(regionCode);
    const row = findPartnerPlanRegionRow(
      mapPricingRows(plan.pricingByRegion) as {
        regionCode: string;
        priceMonthly: number;
        priceYearly: number;
        currency: string;
      }[],
      lookup,
    );
    return {
      priceMonthly:
        row?.priceMonthly ?? Math.max(0, Number(plan.priceMonthly ?? 0)),
      priceYearly:
        row?.priceYearly ?? Math.max(0, Number(plan.priceYearly ?? 0)),
      currency: (
        row?.currency ||
        String(plan.currency ?? 'CAD')
      )
        .trim()
        .toUpperCase() || 'CAD',
      // Conserve la région demandée même sans ligne (repli défauts plan).
      regionCode: row?.regionCode ?? lookup,
    };
  }

  async listPlansAdmin(user: UserModel, includeInactive = false) {
    this.assertAdmin(user);
    const filter: Record<string, unknown> = {};
    if (!includeInactive) filter.active = true;
    const rows = await this.planModel
      .find(filter)
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean()
      .exec();
    return (rows as Record<string, unknown>[]).map(mapPartnerSubscriptionPlan);
  }

  /** Catalogue actif pour Partner self-service (+ admin). */
  async listActivePlansForPartner(
    user: UserModel,
    regionCode?: string | null,
  ) {
    if (
      user.type !== UserTypeEnum.PARTNER &&
      user.type !== UserTypeEnum.ADMIN
    ) {
      throw new ForbiddenException('partner_subscriptions_partner_only');
    }
    // Prix catalogue = région Partner (candidature), pas défauts CAD implicites.
    const pricingRegion = await this.resolvePricingRegionForUser(
      user,
      regionCode,
    );
    const rows = await this.planModel
      .find({ active: true })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean()
      .exec();
    return (rows as Record<string, unknown>[]).map((doc) => {
      const mapped = mapPartnerSubscriptionPlan(doc);
      const pricing = this.resolvePricingForRegion(doc, pricingRegion);
      return {
        ...mapped,
        priceMonthly: pricing.priceMonthly,
        priceYearly: pricing.priceYearly,
        currency: pricing.currency,
        resolvedRegionCode: pricing.regionCode,
      };
    });
  }

  async createPlan(user: UserModel, dto: CreatePartnerSubscriptionPlanDto) {
    this.assertAdmin(user);
    const trialDays = Math.max(0, Math.floor(Number(dto.trialDays ?? 0)));
    const trialReminderDays = normalizePartnerTrialReminderDays(
      dto.trialReminderDays,
      trialDays,
    );
    const payoutDelayDays = normalizePartnerPlanPayoutDelayDays(
      dto.payoutDelayDays,
    );
    const doc = await this.planModel.create({
      name: dto.name.trim(),
      description: (dto.description ?? '').trim(),
      priceMonthly: Math.max(0, Number(dto.priceMonthly)),
      priceYearly: Math.max(0, Number(dto.priceYearly)),
      currency: (dto.currency ?? 'CAD').trim().toUpperCase() || 'CAD',
      active: dto.active !== false,
      sortOrder: Number(dto.sortOrder ?? 0),
      trialDays,
      payoutDelayDays,
      trialReminderDays,
      pricingByRegion: normalizePlanRegionPricing(dto.pricingByRegion),
      customerOrderCommissionsByRegion: normalizePlanRegionOrderCommissions(
        dto.customerOrderCommissionsByRegion,
      ),
      vendorSalesCommissionsByRegion: normalizePlanRegionOrderCommissions(
        dto.vendorSalesCommissionsByRegion,
      ),
      courierGainsCommissionsByRegion: normalizePlanRegionOrderCommissions(
        dto.courierGainsCommissionsByRegion,
      ),
      payoutFeesByRegion: normalizePlanRegionOrderCommissions(
        dto.payoutFeesByRegion,
      ),
    });
    return mapPartnerSubscriptionPlan(doc.toObject() as Record<string, unknown>);
  }

  async updatePlan(
    user: UserModel,
    planId: string,
    dto: UpdatePartnerSubscriptionPlanDto,
  ) {
    this.assertAdmin(user);
    if (!Types.ObjectId.isValid(planId)) {
      throw new NotFoundException('partner_plan_not_found');
    }
    const patch: Record<string, unknown> = {};
    if (dto.name != null) patch.name = dto.name.trim();
    if (dto.description != null) patch.description = dto.description.trim();
    if (dto.priceMonthly != null) {
      patch.priceMonthly = Math.max(0, Number(dto.priceMonthly));
    }
    if (dto.priceYearly != null) {
      patch.priceYearly = Math.max(0, Number(dto.priceYearly));
    }
    if (dto.currency != null) {
      patch.currency = dto.currency.trim().toUpperCase() || 'CAD';
    }
    if (dto.active != null) patch.active = dto.active === true;
    if (dto.sortOrder != null) patch.sortOrder = Number(dto.sortOrder);
    if (dto.trialDays != null || dto.trialReminderDays != null) {
      const existing = await this.planModel.findById(planId).lean().exec();
      if (!existing) throw new NotFoundException('partner_plan_not_found');
      const trialDays =
        dto.trialDays != null
          ? Math.max(0, Math.floor(Number(dto.trialDays)))
          : Math.max(0, Number(existing.trialDays ?? 0));
      patch.trialDays = trialDays;
      patch.trialReminderDays = normalizePartnerTrialReminderDays(
        dto.trialReminderDays ??
          (existing.trialReminderDays as number[] | undefined),
        trialDays,
      );
    }
    if (dto.payoutDelayDays != null) {
      patch.payoutDelayDays = normalizePartnerPlanPayoutDelayDays(
        dto.payoutDelayDays,
      );
    }
    if (dto.pricingByRegion != null) {
      patch.pricingByRegion = normalizePlanRegionPricing(dto.pricingByRegion);
    }
    if (dto.customerOrderCommissionsByRegion != null) {
      patch.customerOrderCommissionsByRegion =
        normalizePlanRegionOrderCommissions(
          dto.customerOrderCommissionsByRegion,
        );
    }
    if (dto.vendorSalesCommissionsByRegion != null) {
      patch.vendorSalesCommissionsByRegion =
        normalizePlanRegionOrderCommissions(dto.vendorSalesCommissionsByRegion);
    }
    if (dto.courierGainsCommissionsByRegion != null) {
      patch.courierGainsCommissionsByRegion =
        normalizePlanRegionOrderCommissions(
          dto.courierGainsCommissionsByRegion,
        );
    }
    if (dto.payoutFeesByRegion != null) {
      patch.payoutFeesByRegion = normalizePlanRegionOrderCommissions(
        dto.payoutFeesByRegion,
      );
    }
    if (!Object.keys(patch).length) {
      throw new BadRequestException('empty_patch');
    }
    const updated = await this.planModel
      .findByIdAndUpdate(planId, { $set: patch }, { new: true })
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('partner_plan_not_found');
    return mapPartnerSubscriptionPlan(updated as Record<string, unknown>);
  }

  async deactivatePlan(user: UserModel, planId: string) {
    this.assertAdmin(user);
    if (!Types.ObjectId.isValid(planId)) {
      throw new NotFoundException('partner_plan_not_found');
    }
    const updated = await this.planModel
      .findByIdAndUpdate(planId, { $set: { active: false } }, { new: true })
      .lean()
      .exec();
    if (!updated) throw new NotFoundException('partner_plan_not_found');
    return mapPartnerSubscriptionPlan(updated as Record<string, unknown>);
  }

  async permanentlyDeletePlan(user: UserModel, planId: string) {
    this.assertAdmin(user);
    if (!Types.ObjectId.isValid(planId)) {
      throw new NotFoundException('partner_plan_not_found');
    }
    const linked = await this.subModel
      .countDocuments({ plan: new Types.ObjectId(planId) })
      .exec();
    if (linked > 0) {
      throw new BadRequestException('partner_plan_has_subscriptions');
    }
    const deleted = await this.planModel.findByIdAndDelete(planId).exec();
    if (!deleted) throw new NotFoundException('partner_plan_not_found');
    return { ok: true, id: planId };
  }

  async getPlanLean(planId: string) {
    if (!Types.ObjectId.isValid(planId)) return null;
    return this.planModel.findById(planId).lean().exec();
  }
}
