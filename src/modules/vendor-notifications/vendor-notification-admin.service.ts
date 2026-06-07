import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  VendorNotificationDeliveryModel,
  VendorNotificationDeliveryStatusEnum,
} from '@schemas/vendor-notification-delivery.schema';
import { VendorNotificationMonthlyChargeModel } from '@schemas/vendor-notification-monthly-charge.schema';
import { StoreModel } from '@schemas/store.schema';
import { Model, Types } from 'mongoose';
import { billingMonthKey } from './vendor-notification-dispatch.service';

@Injectable()
export class VendorNotificationAdminService {
  constructor(
    @InjectModel(VendorNotificationDeliveryModel.name)
    private readonly deliveryModel: Model<VendorNotificationDeliveryModel>,
    @InjectModel(VendorNotificationMonthlyChargeModel.name)
    private readonly chargeModel: Model<VendorNotificationMonthlyChargeModel>,
    @InjectModel(StoreModel.name)
    private readonly storeModel: Model<StoreModel>,
  ) {}

  async platformStats(args: {
    storeId?: string;
    from?: string;
    to?: string;
    billingMonth?: string;
  }) {
    const match: Record<string, unknown> = {
      status: VendorNotificationDeliveryStatusEnum.SENT,
    };
    if (args.storeId && Types.ObjectId.isValid(args.storeId)) {
      match.store = new Types.ObjectId(args.storeId);
    }
    if (args.billingMonth?.trim()) {
      match.billingMonth = args.billingMonth.trim();
    } else {
      const from = args.from ? new Date(args.from) : null;
      const to = args.to ? new Date(args.to) : null;
      if (from || to) {
        match.deliveredAt = {};
        if (from && !Number.isNaN(from.getTime())) {
          (match.deliveredAt as Record<string, Date>).$gte = from;
        }
        if (to && !Number.isNaN(to.getTime())) {
          (match.deliveredAt as Record<string, Date>).$lte = to;
        }
      }
    }

    const [byChannel, byCategory, byStore, smsCost] = await Promise.all([
      this.deliveryModel
        .aggregate([
          { $match: match },
          { $group: { _id: '$channel', count: { $sum: 1 } } },
        ])
        .exec(),
      this.deliveryModel
        .aggregate([
          { $match: match },
          { $group: { _id: '$category', count: { $sum: 1 } } },
        ])
        .exec(),
      this.deliveryModel
        .aggregate([
          { $match: match },
          {
            $group: {
              _id: '$store',
              push: {
                $sum: { $cond: [{ $eq: ['$channel', 'push'] }, 1, 0] },
              },
              email: {
                $sum: { $cond: [{ $eq: ['$channel', 'email'] }, 1, 0] },
              },
              sms: {
                $sum: { $cond: [{ $eq: ['$channel', 'sms'] }, 1, 0] },
              },
              smsCostCad: {
                $sum: {
                  $cond: [
                    { $eq: ['$channel', 'sms'] },
                    { $ifNull: ['$unitCostCad', 0] },
                    0,
                  ],
                },
              },
              total: { $sum: 1 },
            },
          },
          { $sort: { smsCostCad: -1, total: -1 } },
          { $limit: 100 },
        ])
        .exec(),
      this.deliveryModel
        .aggregate([
          {
            $match: {
              ...match,
              channel: 'sms',
            },
          },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              costCad: { $sum: { $ifNull: ['$unitCostCad', 0] } },
            },
          },
        ])
        .exec(),
    ]);

    const storeIds = byStore
      .map((r) => r._id)
      .filter((id) => id && Types.ObjectId.isValid(String(id)));
    const stores = await this.storeModel
      .find({ _id: { $in: storeIds } })
      .select('name')
      .lean()
      .exec();
    const storeNameById = new Map(
      stores.map((s) => [String(s._id), String(s.name ?? '').trim()]),
    );

    return {
      billingMonth: args.billingMonth ?? billingMonthKey(new Date()),
      totals: {
        push:
          byChannel.find((r) => r._id === 'push')?.count ?? 0,
        email:
          byChannel.find((r) => r._id === 'email')?.count ?? 0,
        sms: byChannel.find((r) => r._id === 'sms')?.count ?? 0,
        smsCostCad: smsCost[0]?.costCad ?? 0,
      },
      byCategory: byCategory.map((r) => ({
        category: r._id,
        count: r.count,
      })),
      byStore: byStore.map((r) => ({
        storeId: String(r._id),
        storeName: storeNameById.get(String(r._id)) ?? '',
        push: r.push,
        email: r.email,
        sms: r.sms,
        smsCostCad: Math.round((r.smsCostCad ?? 0) * 100) / 100,
        total: r.total,
      })),
    };
  }
}
