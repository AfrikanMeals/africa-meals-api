import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  PlatformPushCampaignModel,
  PlatformPushCampaignStats,
} from '@schemas/platform-push-campaign.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { emptyFcmPlatformCounts } from './fcm-apns-payload.util';
import { NotificationsService } from './notifications.service';
import { PlatformPushCampaignQueueService } from './platform-push-campaign-queue.service';
import {
  PLATFORM_PUSH_CAMPAIGN_ANDROID_CHANNEL,
  PLATFORM_PUSH_CAMPAIGN_FCM_TYPE,
  advanceCampaignCursor,
  campaignJobShouldSend,
  mapPlatformPushCampaignAudience,
  normalizePlatformPushCampaignAudiences,
} from './platform-push-campaign.util';

const USER_BATCH = 500;

export type PlatformPushCampaignRow = {
  id: string;
  title: string;
  body: string;
  imageUrl?: string;
  audiences: string[];
  createdBy: string;
  status: string;
  sentAt?: string;
  stats: PlatformPushCampaignStats;
  createdAt?: string;
};

/**
 * Campagnes push Marketing (admin.marketing).
 * L’envoi FCM est un job de file (lots), interruptible pause / reprise / suppression.
 */
@Injectable()
export class PlatformPushCampaignsService {
  private readonly logger = new Logger(PlatformPushCampaignsService.name);

  constructor(
    @InjectModel(PlatformPushCampaignModel.name)
    private readonly campaignModel: Model<PlatformPushCampaignModel>,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    private readonly notifications: NotificationsService,
    private readonly storeAccess: StoreAccessService,
    @Inject(forwardRef(() => PlatformPushCampaignQueueService))
    private readonly queue: PlatformPushCampaignQueueService,
  ) {}

  /** Historique paginé (création la plus récente d’abord). */
  async listCampaigns(
    user: UserModel,
    args: { limit?: number; offset?: number },
  ): Promise<{ items: PlatformPushCampaignRow[]; total: number }> {
    await this.storeAccess.assertAdminPermission(user, 'admin.marketing');
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
    const offset = Math.max(args.offset ?? 0, 0);

    const [total, docs] = await Promise.all([
      this.campaignModel.countDocuments({}).exec(),
      this.campaignModel
        .find({})
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean()
        .exec(),
    ]);

    return {
      total,
      items: docs.map((d) => this.toRow(d as Record<string, unknown>)),
    };
  }

  async getCampaign(
    user: UserModel,
    campaignId: string,
  ): Promise<PlatformPushCampaignRow> {
    await this.storeAccess.assertAdminPermission(user, 'admin.marketing');
    const doc = await this.findOrThrow(campaignId);
    return this.toRow(doc);
  }

  /**
   * Crée la campagne en `queued` et enqueue.
   * Sans BullMQ : traitement synchrone (même méthode de lots).
   */
  async createAndSend(
    user: UserModel,
    args: {
      audiences: string[];
      title: string;
      body: string;
      imageUrl?: string;
    },
  ): Promise<PlatformPushCampaignRow> {
    await this.storeAccess.assertAdminPermission(user, 'admin.marketing');

    const audiences = normalizePlatformPushCampaignAudiences(args.audiences);
    if (audiences.length === 0) {
      throw new BadRequestException('audiences_required');
    }

    const title = args.title.trim();
    const body = args.body.trim();
    if (!title || !body) {
      throw new BadRequestException('title_body_required');
    }

    const imageUrl = (args.imageUrl ?? '').trim() || undefined;
    const created = await this.campaignModel.create({
      title,
      body,
      imageUrl,
      audiences,
      createdBy: user._id,
      status: 'queued',
      cursor: { audienceIndex: 0 },
      stats: this.emptyStats(),
    });
    const id = (created._id as Types.ObjectId).toHexString();
    this.logger.log(`platform_push_campaign queued id=${id}`);
    const queued = await this.queue.enqueue(id);
    if (!queued) {
      await this.processCampaignJob(id);
    }
    const fresh = await this.campaignModel.findById(id).lean().exec();
    return this.toRow((fresh ?? created.toObject()) as Record<string, unknown>);
  }

  /**
   * Envoi immédiat au jeton(s) d’un seul user. Ne crée pas d’historique.
   * Retourne l’erreur FCM par appareil (ios / android) pour diagnostiquer iOS.
   */
  async sendTestToUser(
    user: UserModel,
    args: { target: string; title: string; body: string; imageUrl?: string },
  ): Promise<{
    userId: string;
    email: string;
    name: string;
    devices: Array<{
      platform: string;
      tokenSuffix: string;
      ok: boolean;
      errorCode?: string;
      errorMessage?: string;
    }>;
  }> {
    await this.storeAccess.assertAdminPermission(user, 'admin.marketing');
    const title = args.title.trim();
    const body = args.body.trim();
    if (!title || !body) {
      throw new BadRequestException('title_body_required');
    }
    const target = args.target.trim();
    const targetUser = await this.findTargetUser(target);
    if (!targetUser) {
      throw new NotFoundException('user_not_found');
    }
    const userId = String(targetUser._id);
    const imageUrl = (args.imageUrl ?? '').trim() || undefined;
    const result = await this.notifications.sendMulticastNotification({
      recipientUserIds: [userId],
      title,
      body,
      imageUrl,
      androidChannelId: PLATFORM_PUSH_CAMPAIGN_ANDROID_CHANNEL,
      probe: true,
      data: {
        type: PLATFORM_PUSH_CAMPAIGN_FCM_TYPE,
        audience: 'customer',
        title,
        body,
        ...(imageUrl ? { imageUrl } : {}),
      },
    });
    return {
      userId,
      email: String(targetUser.email ?? ''),
      name: String(targetUser.fullName ?? targetUser.full_name ?? ''),
      devices: result.devices ?? [],
    };
  }

  private async findTargetUser(
    target: string,
  ): Promise<Record<string, unknown> | null> {
    const email = target.toLowerCase();
    const byId =
      Types.ObjectId.isValid(target) && target.length === 24
        ? await this.userModel.collection.findOne(
            { _id: new Types.ObjectId(target) },
            { projection: { email: 1, fullName: 1, full_name: 1 } },
          )
        : null;
    if (byId) return byId as Record<string, unknown>;
    const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const byEmail = await this.userModel.collection.findOne(
      { email: { $regex: `^${escaped}$`, $options: 'i' } },
      { projection: { email: 1, fullName: 1, full_name: 1 } },
    );
    return (byEmail as Record<string, unknown> | null) ?? null;
  }

  /** Stoppe les lots suivants. Le lot déjà parti se termine. */
  async pauseCampaign(
    user: UserModel,
    campaignId: string,
  ): Promise<PlatformPushCampaignRow> {
    await this.storeAccess.assertAdminPermission(user, 'admin.marketing');
    const doc = await this.findOrThrow(campaignId);
    const status = String(doc.status ?? 'completed');
    if (status !== 'queued' && status !== 'running') {
      throw new BadRequestException('campaign_not_pausable');
    }
    await this.campaignModel
      .updateOne({ _id: doc._id }, { $set: { status: 'paused' } })
      .exec();
    await this.queue.removeWaiting(String(doc._id));
    const fresh = await this.campaignModel.findById(doc._id).lean().exec();
    return this.toRow(fresh as Record<string, unknown>);
  }

  /** Relance depuis le curseur (après pause). */
  async resumeCampaign(
    user: UserModel,
    campaignId: string,
  ): Promise<PlatformPushCampaignRow> {
    await this.storeAccess.assertAdminPermission(user, 'admin.marketing');
    const doc = await this.findOrThrow(campaignId);
    const status = String(doc.status ?? 'completed');
    if (status !== 'paused' && status !== 'queued') {
      throw new BadRequestException('campaign_not_resumable');
    }
    await this.campaignModel
      .updateOne({ _id: doc._id }, { $set: { status: 'running' } })
      .exec();
    const id = String(doc._id);
    const queued = await this.queue.enqueue(id);
    if (!queued) {
      await this.processCampaignJob(id);
    }
    const fresh = await this.campaignModel.findById(id).lean().exec();
    return this.toRow(fresh as Record<string, unknown>);
  }

  /** Annule le job restant puis retire l’historique. */
  async deleteCampaign(user: UserModel, campaignId: string): Promise<{ ok: true }> {
    await this.storeAccess.assertAdminPermission(user, 'admin.marketing');
    const doc = await this.findOrThrow(campaignId);
    await this.campaignModel
      .updateOne({ _id: doc._id }, { $set: { status: 'cancelled' } })
      .exec();
    await this.queue.removeWaiting(String(doc._id));
    await this.campaignModel.deleteOne({ _id: doc._id }).exec();
    return { ok: true };
  }

  /**
   * Worker : lots de 500 jusqu’à pause, annulation, ou fin.
   * Le curseur permet de reprendre après pause sans renvoyer les users déjà passés.
   */
  async processCampaignJob(campaignId: string): Promise<void> {
    if (!Types.ObjectId.isValid(campaignId)) return;
    const oid = new Types.ObjectId(campaignId);

    for (let guard = 0; guard < 20000; guard += 1) {
      const doc = await this.campaignModel.findById(oid).exec();
      if (!doc) return;
      const status = String(doc.status ?? 'completed');
      if (!campaignJobShouldSend(status)) return;

      if (status === 'queued') {
        await this.campaignModel
          .updateOne({ _id: oid, status: 'queued' }, { $set: { status: 'running' } })
          .exec();
      }

      const audiences = normalizePlatformPushCampaignAudiences(
        doc.audiences ?? [],
      );
      const cursor = doc.cursor ?? { audienceIndex: 0 };
      const audienceIndex = Number(cursor.audienceIndex ?? 0);
      if (audienceIndex >= audiences.length) {
        await this.markCompleted(oid);
        return;
      }

      const audience = audiences[audienceIndex];
      const { userType, fcmAudience } = mapPlatformPushCampaignAudience(audience);
      const filter: Record<string, unknown> = {
        type: userType,
        $or: [
          { 'fcm_tokens.0': { $exists: true } },
          { 'fcmTokens.0': { $exists: true } },
        ],
      };
      const lastId = cursor.lastUserId?.trim();
      if (lastId && Types.ObjectId.isValid(lastId)) {
        filter._id = { $gt: new Types.ObjectId(lastId) };
      }

      const rows = await this.userModel.collection
        .find(filter)
        .sort({ _id: 1 })
        .limit(USER_BATCH)
        .project({ _id: 1 })
        .toArray();
      const ids = rows.map((u) => {
        const id = u._id;
        return id instanceof Types.ObjectId ? id.toHexString() : String(id);
      });

      const step = advanceCampaignCursor({
        audienceCount: audiences.length,
        audienceIndex,
        batchIds: ids,
        batchLimit: USER_BATCH,
      });

      let deviceCount = 0;
      let sent = 0;
      let failures = 0;
      const byPlatform = emptyFcmPlatformCounts();
      if (ids.length > 0) {
        const result = await this.flushChunk({
          recipientUserIds: ids,
          title: doc.title,
          body: doc.body,
          imageUrl: doc.imageUrl,
          fcmAudience,
        });
        deviceCount = result.deviceCount;
        sent = result.sent;
        failures = result.failures;
        byPlatform.ios = result.byPlatform.ios;
        byPlatform.android = result.byPlatform.android;
        byPlatform.other = result.byPlatform.other;
      }

      const setFields: Record<string, unknown> = { cursor: step.cursor };
      if (step.done) {
        setFields.status = 'completed';
        setFields.sentAt = new Date();
      }
      // N’écrit pas si pause/annulation est passée pendant le lot.
      const updated = await this.campaignModel
        .updateOne(
          { _id: oid, status: { $in: ['queued', 'running'] } },
          {
            $set: setFields,
            $inc: {
              'stats.targetedUsers': ids.length,
              'stats.deviceCount': deviceCount,
              'stats.sent': sent,
              'stats.failures': failures,
              'stats.byPlatform.ios': byPlatform.ios,
              'stats.byPlatform.android': byPlatform.android,
              'stats.byPlatform.other': byPlatform.other,
            },
          },
        )
        .exec();
      if (!updated.matchedCount || step.done) return;
    }
  }

  private async markCompleted(id: Types.ObjectId): Promise<void> {
    await this.campaignModel
      .updateOne(
        { _id: id, status: { $in: ['queued', 'running'] } },
        { $set: { status: 'completed', sentAt: new Date() } },
      )
      .exec();
  }

  private async findOrThrow(
    campaignId: string,
  ): Promise<Record<string, unknown> & { _id: Types.ObjectId; status?: string; audiences?: string[]; cursor?: { audienceIndex?: number; lastUserId?: string } }> {
    if (!Types.ObjectId.isValid(campaignId)) {
      throw new NotFoundException('campaign_not_found');
    }
    const doc = await this.campaignModel.findById(campaignId).lean().exec();
    if (!doc) throw new NotFoundException('campaign_not_found');
    // lean() ne type pas _id en ObjectId : passage par unknown.
    return doc as unknown as Record<string, unknown> & {
      _id: Types.ObjectId;
      status?: string;
      audiences?: string[];
      cursor?: { audienceIndex?: number; lastUserId?: string };
    };
  }

  private emptyStats(): PlatformPushCampaignStats {
    return {
      targetedUsers: 0,
      deviceCount: 0,
      sent: 0,
      failures: 0,
      byPlatform: emptyFcmPlatformCounts(),
    };
  }

  private async flushChunk(args: {
    recipientUserIds: string[];
    title: string;
    body: string;
    imageUrl?: string;
    fcmAudience: string;
  }): Promise<{
    sent: number;
    failures: number;
    deviceCount: number;
    byPlatform: PlatformPushCampaignStats['byPlatform'];
  }> {
    const data: Record<string, string> = {
      type: PLATFORM_PUSH_CAMPAIGN_FCM_TYPE,
      audience: args.fcmAudience,
      title: args.title,
      body: args.body,
    };
    if (args.imageUrl) {
      data.imageUrl = args.imageUrl;
    }

    return this.notifications.sendMulticastNotification({
      recipientUserIds: args.recipientUserIds,
      title: args.title,
      body: args.body,
      data,
      androidChannelId: PLATFORM_PUSH_CAMPAIGN_ANDROID_CHANNEL,
      imageUrl: args.imageUrl,
    });
  }

  private toRow(raw: Record<string, unknown>): PlatformPushCampaignRow {
    const id =
      raw._id instanceof Types.ObjectId
        ? raw._id.toHexString()
        : String(raw._id ?? raw.id ?? '');
    const createdByRaw = raw.createdBy;
    const createdBy =
      createdByRaw instanceof Types.ObjectId
        ? createdByRaw.toHexString()
        : String(createdByRaw ?? '');
    const sentAt =
      raw.sentAt instanceof Date
        ? raw.sentAt.toISOString()
        : raw.sentAt
          ? String(raw.sentAt)
          : undefined;
    const createdAt =
      raw.createdAt instanceof Date
        ? raw.createdAt.toISOString()
        : raw.createdAt
          ? String(raw.createdAt)
          : undefined;
    const statsRaw = (raw.stats ?? {}) as Partial<PlatformPushCampaignStats> & {
      byPlatform?: Partial<PlatformPushCampaignStats['byPlatform']>;
    };
    const imageUrl =
      typeof raw.imageUrl === 'string' && raw.imageUrl.trim()
        ? raw.imageUrl.trim()
        : undefined;
    const plat: Partial<PlatformPushCampaignStats['byPlatform']> =
      statsRaw.byPlatform ?? {};

    return {
      id,
      title: String(raw.title ?? ''),
      body: String(raw.body ?? ''),
      imageUrl,
      audiences: Array.isArray(raw.audiences)
        ? raw.audiences.map((a) => String(a))
        : [],
      createdBy,
      status: String(raw.status ?? 'completed'),
      sentAt,
      createdAt,
      stats: {
        targetedUsers: Number(statsRaw.targetedUsers ?? 0),
        deviceCount: Number(statsRaw.deviceCount ?? 0),
        sent: Number(statsRaw.sent ?? 0),
        failures: Number(statsRaw.failures ?? 0),
        byPlatform: {
          ios: Number(plat.ios ?? 0),
          android: Number(plat.android ?? 0),
          other: Number(plat.other ?? 0),
        },
      },
    };
  }
}
