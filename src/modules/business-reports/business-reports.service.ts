import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  BusinessStoreReportModel,
  BusinessStoreReportCategoryEnum,
  BusinessStoreReportSeverityEnum,
} from '@schemas/business-store-report.schema';
import { OrderModel } from '@schemas/order.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { AdminBusinessReportsQueryDto } from './dto/admin-business-reports-query.dto';
import { CreateBusinessReportDto } from './dto/create-business-report.dto';
import { UpdateBusinessReportAdminDto } from './dto/update-business-report-admin.dto';

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
    } else if (rawStore && typeof rawStore === 'object' && '_id' in rawStore) {
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

    const uid = new Types.ObjectId(String(user.id));
    const existing = await this._reportModel
      .findOne({
        order: new Types.ObjectId(oid),
        reporterUser: uid,
      })
      .select('_id')
      .lean()
      .exec();
    if (existing) {
      throw new BadRequestException('report_already_submitted');
    }

    const doc = await this._reportModel.create({
      store: storeId,
      order: new Types.ObjectId(oid),
      reporterUser: uid,
      details: dto.details.trim(),
      category: dto.category ?? BusinessStoreReportCategoryEnum.OTHER,
    });
    return { id: doc._id.toString() };
  }

  /** Commandes pour lesquelles l’utilisateur a déjà envoyé un signalement. */
  async reportedOrderIdsForUser(
    userId: string,
    orderIds: string[],
  ): Promise<Set<string>> {
    const ids = orderIds
      .map((id) => id.trim())
      .filter((id) => Types.ObjectId.isValid(id));
    if (!ids.length || !Types.ObjectId.isValid(userId)) {
      return new Set();
    }
    const rows = await this._reportModel
      .find({
        reporterUser: new Types.ObjectId(userId),
        order: { $in: ids.map((id) => new Types.ObjectId(id)) },
      })
      .select('order')
      .lean()
      .exec();
    return new Set(
      rows.map((r) => {
        const o = r.order as unknown;
        if (o instanceof Types.ObjectId) {
          return o.toHexString();
        }
        return String(o);
      }),
    );
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
      const storeId = st && st['_id'] != null ? String(st['_id']) : 'unknown';
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
        category: typeof r['category'] === 'string' ? r['category'] : undefined,
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

  async listForAdmin(
    user: UserModel,
    query: AdminBusinessReportsQueryDto,
  ): Promise<{
    items: Array<{
      id: string;
      createdAt: string;
      details: string;
      category: string | null;
      severity: BusinessStoreReportSeverityEnum | null;
      archived: boolean;
      archivedAt: string | null;
      store: {
        id: string;
        name: string;
        email: string | null;
        profileImage: string | null;
        vendor: {
          id: string;
          fullName: string;
          email: string | null;
        } | null;
      };
      order: { id: string; status: string | null; totalPrice: number | null } | null;
      reporter: {
        id: string;
        fullName: string;
        email: string | null;
      } | null;
    }>;
    total: number;
    page: number;
    take: number;
    hasMore: boolean;
    stores: Array<{ id: string; name: string }>;
    filters: {
      storeId: string | null;
      archived: boolean | null;
    };
  }> {
    this.assertAdmin(user);

    const page = Math.max(1, Number(query.page) || 1);
    const take = Math.min(100, Math.max(1, Number(query.take) || 20));
    const storeIdRaw = String(query.storeId ?? '').trim();
    const where: Record<string, unknown> = {};

    if (storeIdRaw) {
      if (!Types.ObjectId.isValid(storeIdRaw)) {
        throw new BadRequestException('invalid_store_id');
      }
      where.store = new Types.ObjectId(storeIdRaw);
    }
    if (typeof query.archived === 'boolean') {
      where.archived = query.archived;
    }

    const skip = (page - 1) * take;
    const [rows, total, storeRows] = await Promise.all([
      this._reportModel
        .find(where)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(take)
        .populate({
          path: 'store',
          select: 'name profileImage email',
          populate: { path: 'owner', select: 'fullName email' },
        })
        .populate({ path: 'order', select: 'status totalPrice' })
        .populate({ path: 'reporterUser', select: 'fullName email' })
        .lean()
        .exec(),
      this._reportModel.countDocuments(where).exec(),
      this._reportModel
        .aggregate<{ _id: Types.ObjectId; name: string }>([
          { $group: { _id: '$store', count: { $sum: 1 } } },
          {
            $lookup: {
              from: 'stores',
              localField: '_id',
              foreignField: '_id',
              as: 'storeDoc',
            },
          },
          { $unwind: '$storeDoc' },
          {
            $project: {
              _id: 1,
              name: { $ifNull: ['$storeDoc.name', 'Boutique'] },
            },
          },
          { $sort: { name: 1 } },
        ])
        .exec(),
    ]);

    const items = rows.map((r) => this.mapAdminReportRow(r as Record<string, unknown>));

    return {
      items,
      total,
      page,
      take,
      hasMore: page * take < total,
      stores: storeRows.map((s) => ({
        id: String(s._id),
        name: String(s.name ?? 'Boutique').trim() || 'Boutique',
      })),
      filters: {
        storeId: storeIdRaw || null,
        archived: typeof query.archived === 'boolean' ? query.archived : null,
      },
    };
  }

  async updateForAdmin(
    user: UserModel,
    reportId: string,
    dto: UpdateBusinessReportAdminDto,
  ): Promise<{
    id: string;
    severity: BusinessStoreReportSeverityEnum | null;
    archived: boolean;
    archivedAt: string | null;
  }> {
    this.assertAdmin(user);

    const id = String(reportId ?? '').trim();
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('report_not_found');
    }

    const update: Record<string, unknown> = {};
    if (dto.severity !== undefined) {
      if (
        dto.severity &&
        !Object.values(BusinessStoreReportSeverityEnum).includes(dto.severity)
      ) {
        throw new BadRequestException('invalid_severity');
      }
      update.severity = dto.severity;
    }
    if (dto.archived !== undefined) {
      update.archived = Boolean(dto.archived);
      update.archivedAt = dto.archived ? new Date() : null;
    }

    if (!Object.keys(update).length) {
      throw new BadRequestException('empty_update');
    }

    const updated = await this._reportModel
      .findByIdAndUpdate(new Types.ObjectId(id), { $set: update }, { new: true })
      .select('severity archived archivedAt')
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException('report_not_found');
    }

    const row = updated as Record<string, unknown>;
    const severityRaw = row['severity'];
    const severity =
      typeof severityRaw === 'string' &&
      Object.values(BusinessStoreReportSeverityEnum).includes(
        severityRaw as BusinessStoreReportSeverityEnum,
      )
        ? (severityRaw as BusinessStoreReportSeverityEnum)
        : null;

    const archivedAtRaw = row['archivedAt'];
    const archivedAt =
      archivedAtRaw instanceof Date
        ? archivedAtRaw.toISOString()
        : archivedAtRaw
          ? new Date(String(archivedAtRaw)).toISOString()
          : null;

    return {
      id,
      severity,
      archived: Boolean(row['archived']),
      archivedAt,
    };
  }

  private mapAdminReportRow(r: Record<string, unknown>) {
    const st = r['store'] as Record<string, unknown> | null;
    const owner = st?.['owner'] as Record<string, unknown> | null;
    const ord = r['order'] as Record<string, unknown> | null;
    const rep = r['reporterUser'] as Record<string, unknown> | null;

    let totalPrice: number | null = null;
    const tp = ord?.['totalPrice'];
    if (typeof tp === 'number' && Number.isFinite(tp)) {
      totalPrice = tp;
    } else if (tp != null) {
      const n = Number(tp);
      if (Number.isFinite(n)) totalPrice = n;
    }

    const severityRaw = r['severity'];
    const severity =
      typeof severityRaw === 'string' &&
      Object.values(BusinessStoreReportSeverityEnum).includes(
        severityRaw as BusinessStoreReportSeverityEnum,
      )
        ? (severityRaw as BusinessStoreReportSeverityEnum)
        : null;

    const archivedAtRaw = r['archivedAt'];
    const archivedAt =
      archivedAtRaw instanceof Date
        ? archivedAtRaw.toISOString()
        : archivedAtRaw
          ? new Date(String(archivedAtRaw)).toISOString()
          : null;

    const createdAtRaw = r['createdAt'];
    const createdAt =
      createdAtRaw instanceof Date
        ? createdAtRaw.toISOString()
        : createdAtRaw
          ? new Date(String(createdAtRaw)).toISOString()
          : new Date().toISOString();

    return {
      id: String(r['_id']),
      createdAt,
      details: String(r['details'] ?? '').trim(),
      category: typeof r['category'] === 'string' ? r['category'] : null,
      severity,
      archived: Boolean(r['archived']),
      archivedAt,
      store: {
        id: st && st['_id'] != null ? String(st['_id']) : 'unknown',
        name:
          typeof st?.['name'] === 'string' && st['name'].trim()
            ? String(st['name']).trim()
            : 'Boutique',
        email:
          typeof st?.['email'] === 'string' && st['email'].trim()
            ? String(st['email']).trim()
            : null,
        profileImage:
          typeof st?.['profileImage'] === 'string'
            ? st['profileImage'].trim()
            : null,
        vendor:
          owner && owner['_id'] != null
            ? {
                id: String(owner['_id']),
                fullName:
                  typeof owner['fullName'] === 'string'
                    ? owner['fullName'].trim()
                    : '',
                email:
                  typeof owner['email'] === 'string' && owner['email'].trim()
                    ? String(owner['email']).trim()
                    : null,
              }
            : null,
      },
      order:
        ord && ord['_id'] != null
          ? {
              id: String(ord['_id']),
              status:
                typeof ord['status'] === 'string' ? ord['status'] : null,
              totalPrice,
            }
          : null,
      reporter:
        rep && rep['_id'] != null
          ? {
              id: String(rep['_id']),
              fullName:
                typeof rep['fullName'] === 'string'
                  ? rep['fullName'].trim()
                  : '',
              email:
                typeof rep['email'] === 'string' && rep['email'].trim()
                  ? String(rep['email']).trim()
                  : null,
            }
          : null,
    };
  }
}
