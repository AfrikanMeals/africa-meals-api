import {
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  OrderStatusChangeSourceEnum,
  OrderStatusEventModel,
} from '@schemas/order-status-event.schema';
import { OrderStatusEnum } from '@schemas/order.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';

export type RecordOrderStatusChangeParams = {
  orderId: string;
  storeId?: string | null;
  customerUserId?: string | null;
  fromStatus?: OrderStatusEnum | string | null;
  toStatus: OrderStatusEnum | string;
  source: OrderStatusChangeSourceEnum;
  actorUserId?: string | null;
  note?: string | null;
};

@Injectable()
export class OrderStatusEventsService {
  private readonly logger = new Logger(OrderStatusEventsService.name);

  constructor(
    @InjectModel(OrderStatusEventModel.name)
    private readonly _eventModel: Model<OrderStatusEventModel>,
  ) {}

  async record(params: RecordOrderStatusChangeParams): Promise<void> {
    const orderId = params.orderId?.trim();
    if (!orderId || !Types.ObjectId.isValid(orderId)) {
      return;
    }
    const toStatus = String(params.toStatus ?? '').trim() as OrderStatusEnum;
    if (!Object.values(OrderStatusEnum).includes(toStatus)) {
      return;
    }
    const fromRaw = params.fromStatus != null ? String(params.fromStatus).trim() : '';
    const fromStatus =
      fromRaw && Object.values(OrderStatusEnum).includes(fromRaw as OrderStatusEnum)
        ? (fromRaw as OrderStatusEnum)
        : undefined;

    if (fromStatus === toStatus) {
      return;
    }

    try {
      await this._eventModel.create({
        order: new Types.ObjectId(orderId),
        store:
          params.storeId && Types.ObjectId.isValid(params.storeId)
            ? new Types.ObjectId(params.storeId)
            : undefined,
        customerUser:
          params.customerUserId &&
          Types.ObjectId.isValid(params.customerUserId)
            ? new Types.ObjectId(params.customerUserId)
            : undefined,
        fromStatus,
        toStatus,
        source: params.source,
        actorUserId:
          params.actorUserId && Types.ObjectId.isValid(params.actorUserId)
            ? new Types.ObjectId(params.actorUserId)
            : undefined,
        note: params.note?.trim() || undefined,
      });
    } catch (err) {
      this.logger.warn(
        `order status event: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async listForAdmin(
    user: UserModel,
    opts?: { limit?: number; skip?: number; orderId?: string },
  ): Promise<{
    data: Array<{
      _id: string;
      createdAt?: Date;
      fromStatus?: string;
      toStatus: string;
      source: string;
      note?: string;
      order: {
        _id: string;
        status?: string;
        totalPrice?: number;
      } | null;
      store: { _id: string; name?: string } | null;
      customer: { _id: string; fullName?: string; email?: string } | null;
      actor: { _id: string; fullName?: string; email?: string } | null;
    }>;
  }> {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }

    const filter: Record<string, unknown> = {};
    const oid = opts?.orderId?.trim();
    if (oid && Types.ObjectId.isValid(oid)) {
      filter['order'] = new Types.ObjectId(oid);
    }

    const lim =
      typeof opts?.limit === 'number' && opts.limit > 0
        ? Math.min(500, Math.max(1, Math.floor(opts.limit)))
        : 100;
    const skip =
      typeof opts?.skip === 'number' && opts.skip > 0
        ? Math.min(10_000, Math.max(0, Math.floor(opts.skip)))
        : 0;

    const rows = await this._eventModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(lim)
      .populate({ path: 'order', select: 'status totalPrice' })
      .populate({ path: 'store', select: 'name' })
      .populate({ path: 'customerUser', select: 'fullName email' })
      .populate({ path: 'actorUserId', select: 'fullName email' })
      .lean()
      .exec();

    const data = (rows as Record<string, unknown>[]).map((r) => {
      const ord = r['order'] as Record<string, unknown> | null;
      const st = r['store'] as Record<string, unknown> | null;
      const cust = r['customerUser'] as Record<string, unknown> | null;
      const act = r['actorUserId'] as Record<string, unknown> | null;

      return {
        _id: String(r['_id']),
        createdAt: r['createdAt'] as Date | undefined,
        fromStatus:
          typeof r['fromStatus'] === 'string' ? r['fromStatus'] : undefined,
        toStatus: String(r['toStatus'] ?? ''),
        source: String(r['source'] ?? ''),
        note: typeof r['note'] === 'string' ? r['note'] : undefined,
        order:
          ord && ord['_id'] != null
            ? {
                _id: String(ord['_id']),
                status:
                  typeof ord['status'] === 'string' ? ord['status'] : undefined,
                totalPrice:
                  typeof ord['totalPrice'] === 'number'
                    ? ord['totalPrice']
                    : undefined,
              }
            : null,
        store:
          st && st['_id'] != null
            ? {
                _id: String(st['_id']),
                name: typeof st['name'] === 'string' ? st['name'] : undefined,
              }
            : null,
        customer:
          cust && cust['_id'] != null
            ? {
                _id: String(cust['_id']),
                fullName:
                  typeof cust['fullName'] === 'string'
                    ? cust['fullName']
                    : undefined,
                email:
                  typeof cust['email'] === 'string' ? cust['email'] : undefined,
              }
            : null,
        actor:
          act && act['_id'] != null
            ? {
                _id: String(act['_id']),
                fullName:
                  typeof act['fullName'] === 'string'
                    ? act['fullName']
                    : undefined,
                email:
                  typeof act['email'] === 'string' ? act['email'] : undefined,
              }
            : null,
      };
    });

    return { data };
  }
}
