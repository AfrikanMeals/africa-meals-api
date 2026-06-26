import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  UserUsageSessionModel,
  UserUsageSourceEnum,
} from '@schemas/user-usage-session.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { RecordUsageSessionDto } from './dto/record-usage-session.dto';
import type {
  AdminUserUsageTimeResponse,
  UsageTimeSourceStats,
} from './usage-time.types';

const DEFAULT_RANGE_DAYS = 30;
const MAX_OPEN_SESSION_MS = 4 * 60 * 60 * 1000;

function emptySourceStats(): UsageTimeSourceStats {
  return {
    sessionsCount: 0,
    avgSessionSec: 0,
    totalTimeSec: 0,
    lastActiveAt: null,
    peakHours: Array.from({ length: 24 }, (_, hour) => ({ hour, sessions: 0 })),
    peakDays: Array.from({ length: 7 }, (_, day) => ({ day, sessions: 0 })),
  };
}

@Injectable()
export class UsageTimeService {
  @InjectModel(UserUsageSessionModel.name)
  private readonly sessionModel!: Model<UserUsageSessionModel>;

  @InjectModel(UserModel.name)
  private readonly userModel!: Model<UserModel>;

  constructor(private readonly storeAccess: StoreAccessService) {}

  private async assertAdmin(actor: UserModel): Promise<void> {
    if (actor.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('Admin requis');
    }
    await this.storeAccess.assertAdminPermission(actor, 'admin.settings');
  }

  async recordSession(
    user: UserModel,
    dto: RecordUsageSessionDto,
  ): Promise<{ ok: true }> {
    const userId = user._id as Types.ObjectId;
    const sessionId = dto.sessionId.trim();
    const now = new Date();

    if (dto.action === 'start') {
      await this.closeStaleOpenSessions(userId, dto.source, now);
      await this.sessionModel.updateOne(
        { userId, sessionId },
        {
          $setOnInsert: {
            userId,
            sessionId,
            source: dto.source,
            startedAt: now,
          },
          $set: { lastActiveAt: now, updatedAt: now },
          $unset: { endedAt: '', durationSec: '' },
        },
        { upsert: true },
      );
      return { ok: true };
    }

    const existing = await this.sessionModel
      .findOne({ userId, sessionId, source: dto.source })
      .select('_id startedAt lastActiveAt endedAt')
      .lean()
      .exec();

    if (!existing) {
      if (dto.action === 'heartbeat') {
        await this.sessionModel.create({
          userId,
          sessionId,
          source: dto.source,
          startedAt: now,
          lastActiveAt: now,
        });
      }
      return { ok: true };
    }

    if (existing.endedAt) {
      return { ok: true };
    }

    if (dto.action === 'heartbeat') {
      await this.sessionModel.updateOne(
        { _id: existing._id },
        { $set: { lastActiveAt: now, updatedAt: now } },
      );
      return { ok: true };
    }

    const startedAt = new Date(existing.startedAt);
    const lastActiveAt = new Date(existing.lastActiveAt ?? startedAt);
    const endedAt = lastActiveAt > now ? lastActiveAt : now;
    const durationSec = Math.max(
      1,
      Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
    );

    await this.sessionModel.updateOne(
      { _id: existing._id },
      {
        $set: {
          endedAt,
          durationSec,
          lastActiveAt: endedAt,
          updatedAt: now,
        },
      },
    );
    return { ok: true };
  }

  async getUserUsageTime(
    actor: UserModel,
    userId: string,
    rangeDays = DEFAULT_RANGE_DAYS,
  ): Promise<AdminUserUsageTimeResponse> {
    await this.assertAdmin(actor);
    if (!Types.ObjectId.isValid(userId)) {
      throw new NotFoundException('Utilisateur introuvable');
    }
    const exists = await this.userModel.exists({ _id: userId }).exec();
    if (!exists) {
      throw new NotFoundException('Utilisateur introuvable');
    }

    const days = Math.min(Math.max(rangeDays, 1), 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const oid = new Types.ObjectId(userId);

    const [mobile, admin] = await Promise.all([
      this.aggregateSourceStats(oid, UserUsageSourceEnum.MOBILE, since),
      this.aggregateSourceStats(oid, UserUsageSourceEnum.ADMIN, since),
    ]);

    return {
      userId,
      rangeDays: days,
      mobile,
      admin,
    };
  }

  private async closeStaleOpenSessions(
    userId: Types.ObjectId,
    source: UserUsageSourceEnum,
    now: Date,
  ): Promise<void> {
    const staleBefore = new Date(now.getTime() - MAX_OPEN_SESSION_MS);
    const open = await this.sessionModel
      .find({
        userId,
        source,
        endedAt: { $exists: false },
        lastActiveAt: { $lt: staleBefore },
      })
      .select('_id startedAt lastActiveAt')
      .lean()
      .exec();

    for (const row of open) {
      const startedAt = new Date(row.startedAt);
      const lastActiveAt = new Date(row.lastActiveAt ?? startedAt);
      const durationSec = Math.max(
        1,
        Math.round((lastActiveAt.getTime() - startedAt.getTime()) / 1000),
      );
      await this.sessionModel.updateOne(
        { _id: row._id },
        {
          $set: {
            endedAt: lastActiveAt,
            durationSec,
            updatedAt: now,
          },
        },
      );
    }
  }

  private async aggregateSourceStats(
    userId: Types.ObjectId,
    source: UserUsageSourceEnum,
    since: Date,
  ): Promise<UsageTimeSourceStats> {
    const base = emptySourceStats();
    const rows = await this.sessionModel
      .find({ userId, source, startedAt: { $gte: since } })
      .select('startedAt lastActiveAt endedAt durationSec')
      .lean()
      .exec();

    if (!rows.length) return base;

    let totalTimeSec = 0;
    let closedCount = 0;
    let lastActiveMs = 0;

    for (const row of rows) {
      const startedAt = new Date(row.startedAt);
      const lastActiveAt = new Date(row.lastActiveAt ?? startedAt);
      lastActiveMs = Math.max(lastActiveMs, lastActiveAt.getTime());

      const hour = startedAt.getUTCHours();
      const day = startedAt.getUTCDay();
      base.peakHours[hour]!.sessions += 1;
      base.peakDays[day]!.sessions += 1;

      if (row.endedAt && typeof row.durationSec === 'number') {
        totalTimeSec += row.durationSec;
        closedCount += 1;
      } else {
        const openSec = Math.max(
          1,
          Math.round((lastActiveAt.getTime() - startedAt.getTime()) / 1000),
        );
        totalTimeSec += openSec;
        closedCount += 1;
      }
    }

    base.sessionsCount = rows.length;
    base.totalTimeSec = totalTimeSec;
    base.avgSessionSec =
      closedCount > 0 ? Math.round(totalTimeSec / closedCount) : 0;
    base.lastActiveAt =
      lastActiveMs > 0 ? new Date(lastActiveMs).toISOString() : null;
    return base;
  }
}
