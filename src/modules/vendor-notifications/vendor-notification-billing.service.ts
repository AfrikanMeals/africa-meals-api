import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  VendorNotificationDeliveryModel,
  VendorNotificationDeliveryStatusEnum,
} from '@schemas/vendor-notification-delivery.schema';
import {
  VendorNotificationMonthlyChargeModel,
  VendorNotificationChargeStatusEnum,
} from '@schemas/vendor-notification-monthly-charge.schema';
import { StoreModel } from '@schemas/store.schema';
import { Model, Types } from 'mongoose';
import {
  billingMonthKey,
  previousBillingMonthKey,
  VendorNotificationDispatchService,
} from './vendor-notification-dispatch.service';

@Injectable()
export class VendorNotificationBillingService {
  private readonly logger = new Logger(VendorNotificationBillingService.name);

  constructor(
    @InjectModel(VendorNotificationDeliveryModel.name)
    private readonly deliveryModel: Model<VendorNotificationDeliveryModel>,
    @InjectModel(VendorNotificationMonthlyChargeModel.name)
    private readonly chargeModel: Model<VendorNotificationMonthlyChargeModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
    private readonly dispatch: VendorNotificationDispatchService,
  ) {}

  async closeMonthlyChargesForMonth(
    billingMonth = previousBillingMonthKey(),
  ): Promise<{ billingMonth: string; stores: number }> {
    const pricing = await this.dispatch.getPricing();
    const rows = await this.deliveryModel
      .aggregate<{
        _id: Types.ObjectId;
        pushCount: number;
        emailCount: number;
        smsCount: number;
        smsTotalCad: number;
      }>([
        {
          $match: {
            billingMonth,
            status: VendorNotificationDeliveryStatusEnum.SENT,
          },
        },
        {
          $group: {
            _id: '$store',
            pushCount: {
              $sum: { $cond: [{ $eq: ['$channel', 'push'] }, 1, 0] },
            },
            emailCount: {
              $sum: { $cond: [{ $eq: ['$channel', 'email'] }, 1, 0] },
            },
            smsCount: {
              $sum: { $cond: [{ $eq: ['$channel', 'sms'] }, 1, 0] },
            },
            smsTotalCad: {
              $sum: {
                $cond: [
                  { $eq: ['$channel', 'sms'] },
                  { $ifNull: ['$unitCostCad', pricing.smsUnitCostCad] },
                  0,
                ],
              },
            },
          },
        },
      ])
      .exec();

    let stores = 0;
    for (const row of rows) {
      if (!row._id) continue;
      const smsCount = Number(row.smsCount) || 0;
      const smsTotalCad =
        Number(row.smsTotalCad) ||
        smsCount * pricing.smsUnitCostCad;
      await this.chargeModel
        .findOneAndUpdate(
          { store: row._id, billingMonth },
          {
            $set: {
              smsCount,
              smsUnitCostCad: pricing.smsUnitCostCad,
              smsTotalCad: Math.round(smsTotalCad * 100) / 100,
              pushCount: Number(row.pushCount) || 0,
              emailCount: Number(row.emailCount) || 0,
              status:
                smsTotalCad > 0
                  ? VendorNotificationChargeStatusEnum.PENDING
                  : VendorNotificationChargeStatusEnum.WAIVED,
            },
          },
          { upsert: true, new: true },
        )
        .exec();
      stores += 1;
    }

    this.logger.log(
      `Monthly vendor notification charges closed for ${billingMonth}: ${stores} store(s)`,
    );
    return { billingMonth, stores };
  }

  async listMonthlyCharges(args: {
    storeId?: string;
    billingMonth?: string;
    limit?: number;
  }) {
    const filter: Record<string, unknown> = {};
    if (args.storeId && Types.ObjectId.isValid(args.storeId)) {
      filter.store = new Types.ObjectId(args.storeId);
    }
    if (args.billingMonth?.trim()) {
      filter.billingMonth = args.billingMonth.trim();
    }
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const rows = await this.chargeModel
      .find(filter)
      .sort({ billingMonth: -1, smsTotalCad: -1 })
      .limit(limit)
      .populate('store', 'name')
      .lean()
      .exec();
    return rows.map((row) => {
      const storePop = row.store as
        | { _id?: Types.ObjectId; name?: string }
        | Types.ObjectId
        | null
        | undefined;
      const storeId =
        storePop && typeof storePop === 'object' && '_id' in storePop
          ? String(storePop._id)
          : String(storePop ?? '');
      const storeName =
        storePop && typeof storePop === 'object' && 'name' in storePop
          ? String(storePop.name ?? '').trim()
          : '';
      const meta = row as typeof row & {
        createdAt?: Date;
        updatedAt?: Date;
      };
      return {
        id: String(row._id),
        storeId,
        storeName,
        billingMonth: row.billingMonth,
        smsCount: row.smsCount,
        smsUnitCostCad: row.smsUnitCostCad,
        smsTotalCad: row.smsTotalCad,
        pushCount: row.pushCount,
        emailCount: row.emailCount,
        status: row.status,
        dueAt: row.dueAt ?? null,
        checkoutUrl: row.checkoutUrl ?? null,
        stripeCheckoutSessionId: row.stripeCheckoutSessionId ?? null,
        invoicedAt: row.invoicedAt ?? null,
        paidAt: row.paidAt ?? null,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
      };
    });
  }

  async vendorSmsHistory(args: {
    storeId: string;
    limit?: number;
    billingMonth?: string;
  }) {
    const sid = args.storeId.trim();
    const filter: Record<string, unknown> = {
      store: new Types.ObjectId(sid),
      channel: 'sms',
    };
    if (args.billingMonth?.trim()) {
      filter.billingMonth = args.billingMonth.trim();
    }
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
    const rows = await this.deliveryModel
      .find(filter)
      .sort({ deliveredAt: -1 })
      .limit(limit)
      .lean()
      .exec();
    return rows.map((row) => ({
      id: String(row._id),
      status: row.status,
      body: row.body,
      unitCostCad: row.unitCostCad,
      externalId: row.externalId,
      category: row.category,
      deliveredAt: row.deliveredAt,
      billingMonth: row.billingMonth,
      skipReason: row.skipReason,
      errorMessage: row.errorMessage,
    }));
  }
}
