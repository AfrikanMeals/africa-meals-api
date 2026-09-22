import { StoreAccessService } from '@modules/teams/store-access.service';
import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  PlatformPushCampaignModel,
  PlatformPushCampaignStats,
} from '@schemas/platform-push-campaign.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';
import { NotificationsService } from './notifications.service';
import {
  PLATFORM_PUSH_CAMPAIGN_ANDROID_CHANNEL,
  PLATFORM_PUSH_CAMPAIGN_FCM_TYPE,
  PlatformPushCampaignAudience,
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
  sentAt: string;
  stats: PlatformPushCampaignStats;
  createdAt?: string;
};

/**
 * Campagnes push Marketing (admin.marketing) — envoi immédiat FCM multi-audiences.
 * Distinct Ads Panel / `ad_promo`.
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
  ) {}

  /** Historique paginé (plus récent d’abord). */
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
        .sort({ sentAt: -1 })
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

  /**
   * Crée l’historique + envoie FCM immédiatement aux users des audiences
   * qui ont au moins un jeton (`fcm_tokens` / `fcmTokens`).
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

    // URL optionnelle — trim ; vide = pas d’image FCM.
    const imageUrl = (args.imageUrl ?? '').trim() || undefined;

    const stats = await this.sendToAudiences({
      audiences,
      title,
      body,
      imageUrl,
    });

    const sentAt = new Date();
    const created = await this.campaignModel.create({
      title,
      body,
      imageUrl,
      audiences,
      createdBy: user._id,
      sentAt,
      stats,
    });

    return this.toRow(created.toObject() as Record<string, unknown>);
  }

  /**
   * Cursor users par type + jetons FCM ; un lot multicast par audience
   * pour renseigner `data.audience` correctement.
   */
  private async sendToAudiences(args: {
    audiences: PlatformPushCampaignAudience[];
    title: string;
    body: string;
    imageUrl?: string;
  }): Promise<PlatformPushCampaignStats> {
    let targetedUsers = 0;
    let deviceCount = 0;
    let sent = 0;
    let failures = 0;

    // Envoi par audience (data.audience distinct) même si multi-select.
    for (const audience of args.audiences) {
      const { userType, fcmAudience } =
        mapPlatformPushCampaignAudience(audience);
      const cur = this.userModel.collection
        .find({
          type: userType,
          $or: [
            { 'fcm_tokens.0': { $exists: true } },
            { 'fcmTokens.0': { $exists: true } },
          ],
        })
        .project({ _id: 1 })
        .batchSize(USER_BATCH);

      const chunk: string[] = [];
      for await (const u of cur) {
        const id = u._id;
        chunk.push(id instanceof Types.ObjectId ? id.toString() : String(id));
        if (chunk.length >= USER_BATCH) {
          const result = await this.flushChunk({
            recipientUserIds: [...chunk],
            title: args.title,
            body: args.body,
            imageUrl: args.imageUrl,
            fcmAudience,
          });
          targetedUsers += chunk.length;
          deviceCount += result.deviceCount;
          sent += result.sent;
          failures += result.failures;
          chunk.length = 0;
        }
      }
      if (chunk.length > 0) {
        const result = await this.flushChunk({
          recipientUserIds: chunk,
          title: args.title,
          body: args.body,
          imageUrl: args.imageUrl,
          fcmAudience,
        });
        targetedUsers += chunk.length;
        deviceCount += result.deviceCount;
        sent += result.sent;
        failures += result.failures;
      }
    }

    this.logger.log(
      `platform_push_campaign audiences=${args.audiences.join(',')} ` +
        `users=${targetedUsers} devices=${deviceCount} sent=${sent} fail=${failures}`,
    );

    return { targetedUsers, deviceCount, sent, failures };
  }

  private async flushChunk(args: {
    recipientUserIds: string[];
    title: string;
    body: string;
    imageUrl?: string;
    fcmAudience: string;
  }): Promise<{ sent: number; failures: number; deviceCount: number }> {
    const data: Record<string, string> = {
      type: PLATFORM_PUSH_CAMPAIGN_FCM_TYPE,
      audience: args.fcmAudience,
      title: args.title,
      body: args.body,
    };
    // Image aussi en data : foreground local notif si le plugin ne lit pas l’URL système.
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
        : String(raw.sentAt ?? '');
    const createdAt =
      raw.createdAt instanceof Date
        ? raw.createdAt.toISOString()
        : raw.createdAt
          ? String(raw.createdAt)
          : undefined;
    const statsRaw = (raw.stats ?? {}) as Partial<PlatformPushCampaignStats>;
    const imageUrl =
      typeof raw.imageUrl === 'string' && raw.imageUrl.trim()
        ? raw.imageUrl.trim()
        : undefined;

    return {
      id,
      title: String(raw.title ?? ''),
      body: String(raw.body ?? ''),
      imageUrl,
      audiences: Array.isArray(raw.audiences)
        ? raw.audiences.map((a) => String(a))
        : [],
      createdBy,
      sentAt,
      createdAt,
      stats: {
        targetedUsers: Number(statsRaw.targetedUsers ?? 0),
        deviceCount: Number(statsRaw.deviceCount ?? 0),
        sent: Number(statsRaw.sent ?? 0),
        failures: Number(statsRaw.failures ?? 0),
      },
    };
  }
}
