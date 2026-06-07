import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  DashboardAuditLogModel,
} from '@schemas/dashboard-audit-log.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import {
  BatchDashboardAuditEventsDto,
  QueryDashboardAuditEventsDto,
} from './dto/dashboard-audit.dto';

export type DashboardAuditEventRow = {
  id: string;
  actorUserId: string;
  actorType: string;
  actorEmail: string | null;
  actorName: string | null;
  action: string;
  category: string | null;
  path: string | null;
  storeId: string | null;
  storeName: string | null;
  resource: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
  createdAt: string | null;
};

const DEFAULT_RANGE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LIMIT = 500;

function startOfUtcDay(date: Date): Date {
  const d = new Date(date.getTime());
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

@Injectable()
export class DashboardAuditService {
  @InjectModel(DashboardAuditLogModel.name)
  private readonly auditModel: Model<DashboardAuditLogModel>;

  constructor(private readonly storeAccess: StoreAccessService) {}

  async recordBatch(
    user: UserModel,
    dto: BatchDashboardAuditEventsDto,
    reqMeta: { userAgent?: string; ip?: string },
  ): Promise<{ ok: true; inserted: number }> {
    if (!dto.events?.length) {
      return { ok: true, inserted: 0 };
    }
    const actorName = user.fullName?.trim() || undefined;
    const docs = dto.events.map((ev) => {
      const occurredAtRaw = ev.occurredAt ? new Date(ev.occurredAt) : new Date();
      const occurredAt = Number.isNaN(occurredAtRaw.getTime())
        ? new Date()
        : occurredAtRaw;
      let storeOid: Types.ObjectId | undefined;
      if (ev.storeId?.trim() && Types.ObjectId.isValid(ev.storeId.trim())) {
        storeOid = new Types.ObjectId(ev.storeId.trim());
      }
      return {
        actorUserId: user._id,
        actorType: user.type,
        actorEmail: user.email?.trim() || undefined,
        actorName: actorName || undefined,
        action: ev.action.trim().slice(0, 64),
        category: ev.category?.trim().slice(0, 64) || undefined,
        path: ev.path?.trim().slice(0, 512) || undefined,
        storeId: storeOid,
        resource: ev.resource?.trim().slice(0, 128) || undefined,
        resourceId: ev.resourceId?.trim().slice(0, 128) || undefined,
        metadata: ev.metadata ?? {},
        userAgent: reqMeta.userAgent?.slice(0, 512) || undefined,
        ip: reqMeta.ip?.slice(0, 64) || undefined,
        source: 'admin-web',
        occurredAt,
      };
    });
    await this.auditModel.insertMany(docs, { ordered: false });
    return { ok: true, inserted: docs.length };
  }

  async list(
    user: UserModel,
    query: QueryDashboardAuditEventsDto,
  ): Promise<{ items: DashboardAuditEventRow[] }> {
    const limit = MAX_LIMIT;
    const { start, endExclusive } = this.resolveRange(query);
    const filter: Record<string, unknown> = {
      occurredAt: { $gte: start, $lt: endExclusive },
    };

    if (query.action?.trim()) {
      filter.action = query.action.trim().toUpperCase();
    }
    if (query.category?.trim()) {
      filter.category = query.category.trim();
    }
    if (query.path?.trim()) {
      filter.path = { $regex: query.path.trim(), $options: 'i' };
    }
    if (query.actorType?.trim()) {
      filter.actorType = query.actorType.trim().toUpperCase();
    }

    const isAdmin = user.type === UserTypeEnum.ADMIN;
    if (isAdmin) {
      await this.storeAccess.assertAdminPermission(user, 'admin.settings');
      if (query.userId?.trim() && Types.ObjectId.isValid(query.userId.trim())) {
        filter.actorUserId = new Types.ObjectId(query.userId.trim());
      }
      if (query.storeId?.trim() && Types.ObjectId.isValid(query.storeId.trim())) {
        filter.storeId = new Types.ObjectId(query.storeId.trim());
      }
    } else {
      const accessibleStoreIds = await this.resolveAccessibleStoreIds(user);
      if (!accessibleStoreIds.length) {
        filter.actorUserId = user._id;
      } else if (query.storeId?.trim()) {
        const sid = query.storeId.trim();
        if (!accessibleStoreIds.includes(sid)) {
          throw new ForbiddenException('store_access_denied');
        }
        filter.storeId = new Types.ObjectId(sid);
      } else {
        filter.$or = [
          { actorUserId: user._id },
          {
            storeId: {
              $in: accessibleStoreIds.map((id) => new Types.ObjectId(id)),
            },
          },
        ];
      }
    }

    const docs = await this.auditModel
      .find(filter)
      .populate('store', 'name')
      .sort({ occurredAt: -1 })
      .limit(limit)
      .lean()
      .exec();

    return {
      items: (docs as Record<string, unknown>[]).map((doc) =>
        this.toRow(doc),
      ),
    };
  }

  private async resolveAccessibleStoreIds(user: UserModel): Promise<string[]> {
    const entries = await this.storeAccess.resolveStoreAccess(user);
    return entries.map((e) => e.storeId);
  }

  private resolveRange(query: QueryDashboardAuditEventsDto): {
    start: Date;
    endExclusive: Date;
  } {
    const now = new Date();
    const parsedTo = query.to ? new Date(query.to) : null;
    const toBase =
      parsedTo && !Number.isNaN(parsedTo.getTime()) ? parsedTo : now;
    const endExclusive = new Date(startOfUtcDay(toBase).getTime() + DAY_MS);
    const parsedFrom = query.from ? new Date(query.from) : null;
    const start =
      parsedFrom && !Number.isNaN(parsedFrom.getTime())
        ? startOfUtcDay(parsedFrom)
        : startOfUtcDay(
            new Date(endExclusive.getTime() - DEFAULT_RANGE_DAYS * DAY_MS),
          );
    if (start.getTime() >= endExclusive.getTime()) {
      throw new BadRequestException('invalid_date_range');
    }
    return { start, endExclusive };
  }

  private toRow(doc: Record<string, unknown>): DashboardAuditEventRow {
    const store = doc.store as
      | { _id?: Types.ObjectId; name?: string }
      | Types.ObjectId
      | null
      | undefined;
    let storeId: string | null = null;
    let storeName: string | null = null;
    if (store && typeof store === 'object' && '_id' in store) {
      storeId = String(store._id ?? '');
      storeName = String((store as { name?: string }).name ?? '').trim() || null;
    } else if (doc.storeId) {
      storeId = String(doc.storeId);
    }
    const occurredAt = doc.occurredAt ?? doc.occurred_at;
    const createdAt = doc.createdAt ?? doc.created_at;
    return {
      id: String(doc._id ?? ''),
      actorUserId: String(doc.actorUserId ?? doc.actor_user_id ?? ''),
      actorType: String(doc.actorType ?? doc.actor_type ?? ''),
      actorEmail:
        doc.actorEmail != null
          ? String(doc.actorEmail)
          : doc.actor_email != null
            ? String(doc.actor_email)
            : null,
      actorName:
        doc.actorName != null
          ? String(doc.actorName)
          : doc.actor_name != null
            ? String(doc.actor_name)
            : null,
      action: String(doc.action ?? ''),
      category: doc.category != null ? String(doc.category) : null,
      path: doc.path != null ? String(doc.path) : null,
      storeId,
      storeName,
      resource: doc.resource != null ? String(doc.resource) : null,
      resourceId:
        doc.resourceId != null
          ? String(doc.resourceId)
          : doc.resource_id != null
            ? String(doc.resource_id)
            : null,
      metadata:
        doc.metadata && typeof doc.metadata === 'object'
          ? (doc.metadata as Record<string, unknown>)
          : {},
      occurredAt:
        occurredAt instanceof Date
          ? occurredAt.toISOString()
          : occurredAt != null
            ? String(occurredAt)
            : new Date().toISOString(),
      createdAt:
        createdAt instanceof Date
          ? createdAt.toISOString()
          : createdAt != null
            ? String(createdAt)
            : null,
    };
  }
}
