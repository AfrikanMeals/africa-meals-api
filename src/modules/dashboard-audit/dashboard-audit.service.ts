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
  dashboardApiActionFromMethod,
  inferDashboardAuditCategory,
} from './dashboard-audit.util';
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
  /** Rôle boutique (Propriétaire, Manager, …) ou Administrateur. */
  actorStoreRole: string | null;
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

  /** Enregistrement serveur (interceptor) des appels API depuis le dashboard web. */
  recordHttpEvent(
    user: UserModel,
    input: {
      method: string;
      apiPath: string;
      dashboardPath?: string;
      storeId?: string | null;
      status?: number;
      userAgent?: string;
      ip?: string;
      resource?: string;
      resourceId?: string;
      resourceName?: string;
    },
  ): void {
    const actorName = user.fullName?.trim() || undefined;
    const method = input.method.toUpperCase();
    let storeOid: Types.ObjectId | undefined;
    if (input.storeId?.trim() && Types.ObjectId.isValid(input.storeId.trim())) {
      storeOid = new Types.ObjectId(input.storeId.trim());
    }
    const dashboardPath = input.dashboardPath?.trim().slice(0, 512) || undefined;
    const apiPath = input.apiPath.trim().slice(0, 512);
    const resourceName = input.resourceName?.trim().slice(0, 128) || undefined;
    void this.auditModel
      .create({
        actorUserId: user._id,
        actorType: user.type,
        actorEmail: user.email?.trim() || undefined,
        actorName,
        action: dashboardApiActionFromMethod(method),
        category: inferDashboardAuditCategory(dashboardPath, apiPath),
        path: dashboardPath,
        storeId: storeOid,
        resource: input.resource?.trim().slice(0, 128) || resourceName,
        resourceId: input.resourceId?.trim().slice(0, 128) || undefined,
        metadata: {
          method,
          apiPath,
          status: input.status ?? null,
          ...(resourceName ? { resourceName } : {}),
          ...(input.resource ? { resourceType: input.resource } : {}),
        },
        userAgent: input.userAgent?.slice(0, 512) || undefined,
        ip: input.ip?.slice(0, 64) || undefined,
        source: 'admin-web',
        occurredAt: new Date(),
      })
      .catch(() => undefined);
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
    const wantsPlatformScope =
      isAdmin && query.scope?.trim().toLowerCase() === 'platform';

    if (wantsPlatformScope) {
      await this.storeAccess.assertAdminPermission(user, 'admin.settings');
      if (query.userId?.trim() && Types.ObjectId.isValid(query.userId.trim())) {
        filter.actorUserId = new Types.ObjectId(query.userId.trim());
      }
      if (query.storeId?.trim() && Types.ObjectId.isValid(query.storeId.trim())) {
        filter.storeId = new Types.ObjectId(query.storeId.trim());
      }
    } else {
      await this.applyVendorScopeFilter(user, filter, query.storeId?.trim());
    }

    const docs = await this.auditModel
      .find(filter)
      .populate('storeId', 'name')
      .sort({ occurredAt: -1 })
      .limit(limit)
      .lean()
      .exec();

    const rolePairs: Array<{ userId: string; storeId: string }> = [];
    for (const doc of docs as Record<string, unknown>[]) {
      const userId = String(doc.actorUserId ?? doc.actor_user_id ?? '');
      const storeId = this.extractStoreIdFromDoc(doc);
      if (userId && storeId) {
        rolePairs.push({ userId, storeId });
      }
    }
    const roleMap =
      await this.storeAccess.resolveStoreRoleLabelsForActors(rolePairs);

    return {
      items: (docs as Record<string, unknown>[]).map((doc) => {
        const row = this.toRow(doc);
        row.actorStoreRole = this.resolveActorStoreRole(row, roleMap);
        return row;
      }),
    };
  }

  private extractStoreIdFromDoc(doc: Record<string, unknown>): string | null {
    const store = doc.storeId as
      | { _id?: Types.ObjectId; name?: string }
      | Types.ObjectId
      | null
      | undefined;
    if (store && typeof store === 'object' && '_id' in store) {
      return String(store._id ?? '') || null;
    }
    if (doc.storeId) return String(doc.storeId);
    return null;
  }

  private resolveActorStoreRole(
    row: DashboardAuditEventRow,
    roleMap: Map<string, string>,
  ): string | null {
    if (row.storeId) {
      return roleMap.get(`${row.actorUserId}:${row.storeId}`) ?? 'Vendeur';
    }
    if (row.actorType.toUpperCase() === UserTypeEnum.ADMIN) {
      return 'Administrateur';
    }
    if (row.actorType.toUpperCase() === UserTypeEnum.VENDOR) {
      return 'Vendeur';
    }
    return null;
  }

  private async applyVendorScopeFilter(
    user: UserModel,
    filter: Record<string, unknown>,
    storeIdQuery?: string,
  ): Promise<void> {
    const accessibleStoreIds = await this.resolveAccessibleStoreIds(user);
    if (!accessibleStoreIds.length) {
      filter.actorUserId = user._id;
      return;
    }
    if (storeIdQuery?.trim()) {
      const sid = storeIdQuery.trim();
      if (!accessibleStoreIds.includes(sid)) {
        throw new ForbiddenException('store_access_denied');
      }
      filter.storeId = new Types.ObjectId(sid);
      return;
    }
    filter.$or = [
      { actorUserId: user._id },
      {
        storeId: {
          $in: accessibleStoreIds.map((id) => new Types.ObjectId(id)),
        },
      },
    ];
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
    const store = doc.storeId as
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
      actorStoreRole: null,
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
