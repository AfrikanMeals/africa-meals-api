import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  BusinessStoreReportModel,
  BusinessStoreReportCategoryEnum,
} from '@schemas/business-store-report.schema';
import { OrderModel } from '@schemas/order.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { CreateBusinessReportDto } from './dto/create-business-report.dto';

@Injectable()
export class BusinessReportsService {
  constructor(
    @InjectModel(BusinessStoreReportModel.name)
    private readonly _reportModel: Model<BusinessStoreReportModel>,
    @InjectModel(OrderModel.name)
    private readonly _orderModel: Model<OrderModel>,
  ) {}

  private assertAdmin(user: UserModel) {
    if (user.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
  }

  /**
   * Client : enregistre un signalement pour une commande dont il est l’acheteur.
   */
  async createForOrder(
    user: UserModel,
    orderId: string,
    dto: CreateBusinessReportDto,
  ): Promise<{ id: string }> {
    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) {
      throw new NotFoundException('order_not_found');
    }
    const order = await this._orderModel
      .findOne({
        _id: new Types.ObjectId(oid),
        user: new Types.ObjectId(String(user.id)),
      })
      .select('store')
      .lean()
      .exec();
    if (!order) {
      throw new NotFoundException('order_not_found');
    }
    const rawStore = order.store as unknown;
    let storeId: Types.ObjectId | null = null;
    if (rawStore instanceof Types.ObjectId) {
      storeId = rawStore;
    } else if (
      rawStore &&
      typeof rawStore === 'object' &&
      '_id' in rawStore
    ) {
      const sid = (rawStore as { _id: unknown })._id;
      if (sid instanceof Types.ObjectId) {
        storeId = sid;
      } else if (Types.ObjectId.isValid(String(sid))) {
        storeId = new Types.ObjectId(String(sid));
      }
    }
    if (!storeId) {
      throw new NotFoundException('order_store_missing');
    }

    const doc = await this._reportModel.create({
      store: storeId,
      order: new Types.ObjectId(oid),
      reporterUser: new Types.ObjectId(String(user.id)),
      details: dto.details.trim(),
      category: dto.category ?? BusinessStoreReportCategoryEnum.OTHER,
    });
    return { id: doc._id.toString() };
  }

  /**
   * Admin : signalements regroupés par boutique (récent en premier dans chaque groupe).
   */
  async listGroupedByStoreForAdmin(user: UserModel): Promise<{
    groups: Array<{
      store: {
        _id: string;
        name: string;
        profileImage?: string | null;
      };
      reports: Array<{
        _id: string;
        createdAt: Date | undefined;
        details: string;
        category?: string;
        order: { _id: string; status?: string; totalPrice?: number } | null;
        reporter: {
          _id: string;
          fullName?: string;
          email?: string;
        } | null;
      }>;
    }>;
  }> {
    this.assertAdmin(user);
    const rows = await this._reportModel
      .find({})
      .sort({ createdAt: -1 })
      .populate({
        path: 'store',
        select: 'name profileImage',
      })
      .populate({
        path: 'order',
        select: 'status totalPrice',
      })
      .populate({
        path: 'reporterUser',
        select: 'fullName email',
      })
      .limit(2000)
      .lean()
      .exec();

    type Group = {
      store: {
        _id: string;
        name: string;
        profileImage?: string | null;
      };
      reports: Array<{
        _id: string;
        createdAt: Date | undefined;
        details: string;
        category?: string;
        order: { _id: string; status?: string; totalPrice?: number } | null;
        reporter: {
          _id: string;
          fullName?: string;
          email?: string;
        } | null;
      }>;
    };

    const map = new Map<string, Group>();

    for (const r of rows as Record<string, unknown>[]) {
      const st = r['store'] as Record<string, unknown> | null;
      const storeId =
        st && st['_id'] != null ? String(st['_id']) : 'unknown';
      const storeName =
        typeof st?.['name'] === 'string' && st['name'].trim()
          ? String(st['name']).trim()
          : 'Boutique';
      const profileImage =
        typeof st?.['profileImage'] === 'string'
          ? st['profileImage'].trim()
          : null;

      const ord = r['order'] as Record<string, unknown> | null;
      let orderPayload: {
        _id: string;
        status?: string;
        totalPrice?: number;
      } | null = null;
      if (ord && ord['_id'] != null) {
        orderPayload = { _id: String(ord['_id']) };
        if (typeof ord['status'] === 'string') {
          orderPayload.status = ord['status'];
        }
        const tp = ord['totalPrice'];
        if (typeof tp === 'number' && Number.isFinite(tp)) {
          orderPayload.totalPrice = tp;
        } else if (tp != null) {
          const n = Number(tp);
          if (Number.isFinite(n)) {
            orderPayload.totalPrice = n;
          }
        }
      }

      const rep = r['reporterUser'] as Record<string, unknown> | null;
      const reporterPayload =
        rep && rep['_id'] != null
          ? {
              _id: String(rep['_id']),
              fullName:
                typeof rep['fullName'] === 'string'
                  ? rep['fullName']
                  : undefined,
              email:
                typeof rep['email'] === 'string' ? rep['email'] : undefined,
            }
          : null;

      const g =
        map.get(storeId) ??
        ({
          store: {
            _id: storeId,
            name: storeName,
            profileImage,
          },
          reports: [],
        } as Group);
      if (!map.has(storeId)) {
        map.set(storeId, g);
      }

      g.reports.push({
        _id: String(r['_id']),
        createdAt: r['createdAt'] as Date | undefined,
        details: String(r['details'] ?? ''),
        category:
          typeof r['category'] === 'string' ? r['category'] : undefined,
        order: orderPayload,
        reporter: reporterPayload,
      });
    }

    const groups = [...map.values()].sort((a, b) =>
      a.store.name.localeCompare(b.store.name, 'fr', {
        sensitivity: 'base',
      }),
    );

    return { groups };
  }
}
