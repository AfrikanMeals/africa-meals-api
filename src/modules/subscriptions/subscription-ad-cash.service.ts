import { StoreAdCashGrantService } from '@modules/store-ad-cash/store-ad-cash-grant.service';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { SubscriptionPlanModel } from '@schemas/subscription-plan.schema';
import {
  VendorSubscriptionBillingPeriod,
  VendorSubscriptionModel,
  VendorSubscriptionStatus,
} from '@schemas/vendor-subscription.schema';
import { Model, Types } from 'mongoose';

const YEARLY_INSTALLMENTS = 12;

function addMonths(base: Date, months: number): Date {
  const d = new Date(base);
  d.setMonth(d.getMonth() + months);
  return d;
}

function regularYearlyInstallment(total: number): number {
  return Number((total / YEARLY_INSTALLMENTS).toFixed(4));
}

@Injectable()
export class SubscriptionAdCashService {
  private readonly logger = new Logger(SubscriptionAdCashService.name);

  constructor(
    @InjectModel(VendorSubscriptionModel.name)
    private readonly vendorSubModel: Model<VendorSubscriptionModel>,
    @InjectModel(SubscriptionPlanModel.name)
    private readonly planModel: Model<SubscriptionPlanModel>,
    private readonly adCashGrant: StoreAdCashGrantService,
  ) {}

  async applyForActivatedSubscription(subscriptionId: string): Promise<void> {
    const id = String(subscriptionId ?? '').trim();
    if (!Types.ObjectId.isValid(id)) return;

    const sub = await this.vendorSubModel.findById(id).lean().exec();
    if (!sub) return;
    if (sub.status !== ('ACTIVE' as VendorSubscriptionStatus)) return;
    if (sub.isTrial === true) return;
    if (sub.adCashGiftStartedAt != null) return;

    const plan = await this.planModel.findById(sub.plan).lean().exec();
    if (!plan) return;

    const storeId = String(sub.store);
    const isRenewal = await this._isRenewalForStore(storeId, id);
    const totalGift = Math.max(
      0,
      Number(
        isRenewal ? plan.renewalAdCashGift : plan.initialAdCashGift,
      ) || 0,
    );
    if (totalGift <= 0) {
      await this.vendorSubModel
        .updateOne(
          { _id: sub._id },
          { $set: { adCashGiftStartedAt: new Date() } },
        )
        .exec();
      return;
    }

    const period = sub.billingPeriod as VendorSubscriptionBillingPeriod;
    const now = new Date();
    const giftKind = isRenewal ? 'renewal' : 'initial';

    if (period === 'YEARLY') {
      const firstAmount = regularYearlyInstallment(totalGift);
      await this.adCashGrant.grantFromSubscriptionPlan(
        storeId,
        firstAmount,
        `plan_${giftKind}_ad_cash_yearly_1_of_${YEARLY_INSTALLMENTS}`,
      );
      await this.vendorSubModel
        .updateOne(
          { _id: sub._id },
          {
            $set: {
              adCashGiftStartedAt: now,
              adCashInstallmentTotal: totalGift,
              adCashInstallmentGranted: firstAmount,
              adCashInstallmentsRemaining: YEARLY_INSTALLMENTS - 1,
              adCashNextInstallmentAt: addMonths(now, 1),
            },
          },
        )
        .exec();
      return;
    }

    await this.adCashGrant.grantFromSubscriptionPlan(
      storeId,
      totalGift,
      `plan_${giftKind}_ad_cash`,
    );
    await this.vendorSubModel
      .updateOne(
        { _id: sub._id },
        {
          $set: {
            adCashGiftStartedAt: now,
            adCashInstallmentTotal: totalGift,
            adCashInstallmentGranted: totalGift,
            adCashInstallmentsRemaining: 0,
            adCashNextInstallmentAt: null,
          },
        },
      )
      .exec();
  }

  async processDueInstallments(): Promise<number> {
    const now = new Date();
    const due = await this.vendorSubModel
      .find({
        status: 'ACTIVE',
        adCashInstallmentsRemaining: { $gt: 0 },
        adCashNextInstallmentAt: { $lte: now },
      })
      .lean()
      .exec();

    let processed = 0;
    for (const sub of due) {
      try {
        const applied = await this._processOneInstallment(sub);
        if (applied) processed += 1;
      } catch (e) {
        this.logger.warn(
          `Ad Cash installment failed sub=${String(sub._id)}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
    return processed;
  }

  private async _processOneInstallment(
    sub: VendorSubscriptionModel & { _id: Types.ObjectId },
  ): Promise<boolean> {
    const remaining = Math.max(0, Number(sub.adCashInstallmentsRemaining ?? 0));
    if (remaining <= 0) return false;

    const total = Math.max(0, Number(sub.adCashInstallmentTotal ?? 0));
    const grantedSoFar = Math.max(0, Number(sub.adCashInstallmentGranted ?? 0));
    const amount =
      remaining === 1
        ? Number(Math.max(0, total - grantedSoFar).toFixed(4))
        : regularYearlyInstallment(total);
    if (amount <= 0) {
      await this.vendorSubModel
        .updateOne(
          { _id: sub._id },
          {
            $set: {
              adCashInstallmentsRemaining: 0,
              adCashNextInstallmentAt: null,
            },
          },
        )
        .exec();
      return false;
    }

    const installmentIndex = YEARLY_INSTALLMENTS - remaining + 1;
    await this.adCashGrant.grantFromSubscriptionPlan(
      String(sub.store),
      amount,
      `plan_ad_cash_yearly_${installmentIndex}_of_${YEARLY_INSTALLMENTS}`,
    );

    const newRemaining = remaining - 1;
    const nextAt =
      newRemaining > 0 && sub.adCashNextInstallmentAt
        ? addMonths(new Date(sub.adCashNextInstallmentAt), 1)
        : null;

    await this.vendorSubModel
      .updateOne(
        { _id: sub._id },
        {
          $set: {
            adCashInstallmentGranted: Number(
              (grantedSoFar + amount).toFixed(4),
            ),
            adCashInstallmentsRemaining: newRemaining,
            adCashNextInstallmentAt: nextAt,
          },
        },
      )
      .exec();
    return true;
  }

  private async _isRenewalForStore(
    storeId: string,
    currentSubId: string,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(storeId)) return false;
    const count = await this.vendorSubModel
      .countDocuments({
        store: new Types.ObjectId(storeId),
        _id: { $ne: new Types.ObjectId(currentSubId) },
        status: { $in: ['ACTIVE', 'EXPIRED'] },
      })
      .exec();
    return count > 0;
  }
}
