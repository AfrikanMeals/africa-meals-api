import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { JobsOptions, Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { parsePositiveInt } from '@common/bullmq-redis.connection';
import { AdNotificationDispatchQueueService } from '@modules/ads/ad-notification-dispatch-queue.service';
import type {
  AdNotifyEntityJob,
  AdNotifyRecipientBatchJob,
} from '@modules/ads/ad-notification-dispatch.types';
import { MailerService } from '@modules/mailer/mailer.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import {
  notificationAddonFromDoc,
  type NotificationAddonPayload,
} from '@modules/ads/ad-notification.util';
import {
  aggregateNotificationBillingMetrics,
  buildEmptyNotificationBillingMetrics,
  computeNotificationBillingAmountCad,
  type AdNotificationBillingMetrics,
  type AdNotificationPricingRates,
} from '@modules/ads/ad-notification-billing.util';
import {
  buildAdNotificationAppDeepLink,
  buildAdNotificationWebOpenUrl,
} from '@modules/ads/ad-notification-link.util';
import { trySendAdSms } from '@modules/ads/twilio-sms.util';
import { trySendAdWhatsApp } from '@modules/ads/twilio-whatsapp.util';
import { TrackAdNotificationEventDto, TrackAdNotificationEventKindEnum } from '@modules/ads/dto/ad-notification-tracking.dto';
import { AdModel } from '@schemas/ad.schema';
import { AdCampaignModel } from '@schemas/ad-campaign.schema';
import {
  AdNotificationChannelEnum,
  AdNotificationEntityTypeEnum,
  AdNotificationEventModel,
} from '@schemas/ad-notification-event.schema';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';

const AUDIENCE_ORDER_STATUSES = [
  OrderStatusEnum.COMPLETED,
  OrderStatusEnum.SHIPPED,
  OrderStatusEnum.PAIED,
  OrderStatusEnum.APPROVED,
];

const AUDIENCE_LOOKBACK_DAYS = 180;
const MAX_RECIPIENTS_PER_DISPATCH = 5000;
const DEFAULT_RECIPIENT_BATCH_SIZE = 50;
const DEFAULT_RECIPIENT_PARALLEL = 12;
const DEFAULT_FCM_PARALLEL = 20;

type RecipientRow = {
  userId: string;
  email: string;
  phone: string;
  fullName: string;
};

@Injectable()
export class AdNotificationService {
  private readonly logger = new Logger(AdNotificationService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectModel(AdModel.name) private readonly adModel: Model<AdModel>,
    @InjectModel(AdCampaignModel.name)
    private readonly campaignModel: Model<AdCampaignModel>,
    @InjectModel(AdNotificationEventModel.name)
    private readonly eventModel: Model<AdNotificationEventModel>,
    @InjectModel(OrderModel.name) private readonly orderModel: Model<OrderModel>,
    @InjectModel(UserModel.name) private readonly userModel: Model<UserModel>,
    @InjectModel(StoreModel.name) private readonly storeModel: Model<StoreModel>,
    private readonly notifications: NotificationsService,
    private readonly mailer: MailerService,
    @Inject(forwardRef(() => AdNotificationDispatchQueueService))
    private readonly dispatchQueue: AdNotificationDispatchQueueService,
  ) {}

  private recipientBatchSize(): number {
    return parsePositiveInt(
      this.config.get<string>('AD_NOTIFICATION_RECIPIENT_BATCH_SIZE'),
      DEFAULT_RECIPIENT_BATCH_SIZE,
    );
  }

  private recipientParallel(): number {
    return parsePositiveInt(
      this.config.get<string>('AD_NOTIFICATION_RECIPIENT_PARALLEL'),
      DEFAULT_RECIPIENT_PARALLEL,
    );
  }

  /** Exécution pool limité — évite de saturer SMTP / Twilio / Mongo. */
  private async mapPool<T>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<void>,
  ): Promise<void> {
    if (!items.length) return;
    let index = 0;
    const workers = Math.min(Math.max(1, limit), items.length);
    await Promise.all(
      Array.from({ length: workers }, async () => {
        for (;;) {
          const i = index++;
          if (i >= items.length) break;
          await fn(items[i]);
        }
      }),
    );
  }

  private webBaseUrl(): string {
    return (
      this.config.get<string>('PUBLIC_WEB_URL')?.trim() ||
      this.config.get<string>('EMAIL_WEBSITE_URL')?.trim() ||
      this.config.get<string>('DASHBOARD_BASE_URL')?.trim() ||
      'https://wise-eat.com'
    );
  }

  private appScheme(): string {
    return this.config.get<string>('MOBILE_DEEP_LINK_SCHEME')?.trim() || 'wise-eat';
  }

  /** Lien de clic tracké (e-mail / SMS) — préfère l’API publique si configurée. */
  private trackedClickUrl(params: {
    deliveryId: string;
    entityType: AdNotificationEntityTypeEnum;
    entityId: string;
    storeId: string;
  }): string {
    const apiBase = this.config.get<string>('API_PUBLIC_BASE_URL')?.trim();
    if (apiBase) {
      return `${apiBase.replace(/\/+$/, '')}/ads/notifications/click/${encodeURIComponent(params.deliveryId)}`;
    }
    return buildAdNotificationWebOpenUrl({
      deliveryId: params.deliveryId,
      entityType: params.entityType,
      entityId: params.entityId,
      storeId: params.storeId,
      webBaseUrl: this.webBaseUrl(),
      appScheme: this.appScheme(),
    });
  }

  async runDispatchPass(): Promise<{
    bannersDispatched: number;
    campaignsDispatched: number;
  }> {
    const now = new Date();
    let bannersDispatched = 0;
    let campaignsDispatched = 0;

    const banners = await this.adModel
      .find({
        isActive: true,
        validUntil: { $gte: now },
        'notificationAddon.enabled': true,
        $and: [
          { $or: [{ archivedAt: { $exists: false } }, { archivedAt: null }] },
          {
            $or: [
              { notificationDispatchedAt: { $exists: false } },
              { notificationDispatchedAt: null },
            ],
          },
        ],
      })
      .select('_id store title subtitle notificationAddon audienceTotal')
      .limit(20)
      .lean()
      .exec();

    for (const row of banners as Array<Record<string, unknown>>) {
      const addon = notificationAddonFromDoc(
        row.notificationAddon as Record<string, unknown>,
      );
      if (!addon.enabled) continue;
      try {
        await this.dispatchBanner(row, addon);
        bannersDispatched++;
      } catch (e) {
        this.logger.warn(
          `dispatch banner ${row._id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    const campaigns = await this.campaignModel
      .find({
        isActive: true,
        startsAt: { $lte: now },
        endsAt: { $gte: now },
        'notificationAddon.enabled': true,
        $and: [
          { $or: [{ archivedAt: { $exists: false } }, { archivedAt: null }] },
          {
            $or: [
              { notificationDispatchedAt: { $exists: false } },
              { notificationDispatchedAt: null },
            ],
          },
        ],
      })
      .select('_id store title subtitle notificationAddon audienceTotal')
      .limit(20)
      .lean()
      .exec();

    for (const row of campaigns as Array<Record<string, unknown>>) {
      const addon = notificationAddonFromDoc(
        row.notificationAddon as Record<string, unknown>,
      );
      if (!addon.enabled) continue;
      try {
        await this.dispatchCampaign(row, addon);
        campaignsDispatched++;
      } catch (e) {
        this.logger.warn(
          `dispatch campaign ${row._id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    return { bannersDispatched, campaignsDispatched };
  }

  private async resolveStoreAudience(
    storeId: Types.ObjectId,
    cap: number | null,
  ): Promise<RecipientRow[]> {
    const since = new Date(
      Date.now() - AUDIENCE_LOOKBACK_DAYS * 86_400_000,
    );
    const userIds = await this.orderModel
      .distinct('user', {
        store: storeId,
        status: { $in: AUDIENCE_ORDER_STATUSES },
        createdAt: { $gte: since },
      })
      .exec();

    const validIds = (userIds as string[])
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (!validIds.length) return [];

    const limit = Math.min(
      cap && cap > 0 ? cap : MAX_RECIPIENTS_PER_DISPATCH,
      MAX_RECIPIENTS_PER_DISPATCH,
    );
    const users = await this.userModel
      .find({ _id: { $in: validIds.slice(0, limit * 2) } })
      .select('_id email phoneNumber fullName')
      .limit(limit)
      .lean()
      .exec();

    return users.map((u) => {
      const raw = u as Record<string, unknown>;
      return {
        userId: String(raw._id),
        email: String(raw.email ?? '').trim(),
        phone: String(raw.phoneNumber ?? '').trim(),
        fullName: String(raw.fullName ?? '').trim() || 'Client',
      };
    });
  }

  private async dispatchBanner(
    row: Record<string, unknown>,
    addon: NotificationAddonPayload,
  ): Promise<void> {
    const adId = new Types.ObjectId(String(row._id));
    const storeId = new Types.ObjectId(String(row.store));
    const cap =
      row.audienceTotal != null ? Math.floor(Number(row.audienceTotal)) : null;
    const recipients = await this.resolveStoreAudience(storeId, cap);
    const store = await this.storeModel
      .findById(storeId)
      .select('name')
      .lean()
      .exec();
    const storeName = String((store as { name?: string } | null)?.name ?? 'Restaurant');
    const title = String(row.title ?? 'Offre');
    const subtitle = String(row.subtitle ?? '').trim();

    await this.sendBatch({
      entityType: AdNotificationEntityTypeEnum.BANNER,
      entityId: adId.toString(),
      adId,
      storeId,
      storeName,
      title,
      body: subtitle || `${storeName} a une nouvelle offre pour vous.`,
      addon,
      recipients,
    });

    await this.adModel
      .updateOne({ _id: adId }, { $set: { notificationDispatchedAt: new Date() } })
      .exec();
  }

  private async dispatchCampaign(
    row: Record<string, unknown>,
    addon: NotificationAddonPayload,
  ): Promise<void> {
    const campaignId = new Types.ObjectId(String(row._id));
    const storeId = new Types.ObjectId(String(row.store));
    const cap =
      row.audienceTotal != null ? Math.floor(Number(row.audienceTotal)) : null;
    const recipients = await this.resolveStoreAudience(storeId, cap);
    const store = await this.storeModel
      .findById(storeId)
      .select('name')
      .lean()
      .exec();
    const storeName = String((store as { name?: string } | null)?.name ?? 'Restaurant');
    const title = String(row.title ?? 'Campagne');
    const subtitle = String(row.subtitle ?? '').trim();

    await this.sendBatch({
      entityType: AdNotificationEntityTypeEnum.CAMPAIGN,
      entityId: campaignId.toString(),
      campaignId,
      storeId,
      storeName,
      title,
      body: subtitle || `${storeName} : découvrez notre campagne.`,
      addon,
      recipients,
    });

    await this.campaignModel
      .updateOne(
        { _id: campaignId },
        { $set: { notificationDispatchedAt: new Date() } },
      )
      .exec();
  }

  private async sendBatch(args: {
    entityType: AdNotificationEntityTypeEnum;
    entityId: string;
    adId?: Types.ObjectId;
    campaignId?: Types.ObjectId;
    storeId: Types.ObjectId;
    storeName: string;
    title: string;
    body: string;
    addon: NotificationAddonPayload;
    recipients: RecipientRow[];
  }): Promise<void> {
    if (!args.recipients.length) {
      this.logger.log(
        `ad notification ${args.entityType} ${args.entityId}: audience vide`,
      );
      return;
    }

    for (let i = 0; i < args.recipients.length; i += DISPATCH_CHUNK) {
      const slice = args.recipients.slice(i, i + DISPATCH_CHUNK);
      await Promise.all(
        slice.map((r) =>
          this.sendToRecipient({
            ...args,
            recipient: r,
          }),
        ),
      );
    }
  }

  private async sendToRecipient(args: {
    entityType: AdNotificationEntityTypeEnum;
    entityId: string;
    adId?: Types.ObjectId;
    campaignId?: Types.ObjectId;
    storeId: Types.ObjectId;
    storeName: string;
    title: string;
    body: string;
    addon: NotificationAddonPayload;
    recipient: RecipientRow;
  }): Promise<void> {
    const { addon, recipient } = args;
    const linkBase = {
      entityType: args.entityType,
      entityId: args.entityId,
      storeId: args.storeId.toString(),
      webBaseUrl: this.webBaseUrl(),
      appScheme: this.appScheme(),
    };

    const tasks: Promise<void>[] = [];

    if (addon.channels.email && recipient.email) {
      tasks.push(
        this.sendEmailChannel({ ...args, linkBase, deliveryId: randomUUID() }),
      );
    }
    if (addon.channels.sms && recipient.phone) {
      tasks.push(
        this.sendSmsChannel({ ...args, linkBase, deliveryId: randomUUID() }),
      );
    }
    if (addon.channels.inApp || addon.channels.push) {
      tasks.push(
        this.sendFcmMobileChannels({
          ...args,
          linkBase,
          inApp: addon.channels.inApp,
          push: addon.channels.push,
        }),
      );
    }
    if (addon.channels.whatsapp && recipient.phone) {
      tasks.push(
        this.sendWhatsappChannel({ ...args, linkBase, deliveryId: randomUUID() }),
      );
    }

    await Promise.all(tasks);
  }

  private async recordDelivery(args: {
    deliveryId: string;
    entityType: AdNotificationEntityTypeEnum;
    adId?: Types.ObjectId;
    campaignId?: Types.ObjectId;
    storeId: Types.ObjectId;
    userId: string;
    channel: AdNotificationChannelEnum;
  }): Promise<void> {
    await this.eventModel.create({
      deliveryId: args.deliveryId,
      entityType: args.entityType,
      ad: args.adId,
      campaign: args.campaignId,
      store: args.storeId,
      user: new Types.ObjectId(args.userId),
      channel: args.channel,
      deliveredAt: new Date(),
    });
  }

  /** Canal Android FCM — doit correspondre à l’app Flutter (`african_meals_promotions`). */
  private adFcmAndroidChannelId(): string {
    return (
      this.config.get<string>('AD_NOTIFICATION_FCM_ANDROID_CHANNEL')?.trim() ||
      'african_meals_promotions'
    );
  }

  private buildAdFcmData(args: {
    deliveryId: string;
    entityType: AdNotificationEntityTypeEnum;
    entityId: string;
    storeId: string;
    storeName: string;
    title: string;
    linkBase: Omit<Parameters<typeof buildAdNotificationAppDeepLink>[0], 'deliveryId'>;
  }): Record<string, string> {
    const deepLink = buildAdNotificationAppDeepLink({
      ...args.linkBase,
      deliveryId: args.deliveryId,
    });
    return {
      ...this.pushDataPayload({
        deliveryId: args.deliveryId,
        entityType: args.entityType,
        entityId: args.entityId,
        storeId: args.storeId,
        storeName: args.storeName,
        title: args.title,
      }),
      deepLink,
    };
  }

  private pushDataPayload(args: {
    deliveryId: string;
    entityType: AdNotificationEntityTypeEnum;
    entityId: string;
    storeId: string;
    storeName: string;
    title: string;
  }): Record<string, string> {
    return {
      type: 'ad_promo',
      audience: 'customer',
      deliveryId: args.deliveryId,
      entity:
        args.entityType === AdNotificationEntityTypeEnum.CAMPAIGN
          ? 'campaign'
          : 'banner',
      entityId: args.entityId,
      storeId: args.storeId,
      storeName: args.storeName,
      title: args.title,
    };
  }

  /**
   * In-App + Push : inbox Mongo + un seul envoi FCM (évite les doublons si les deux canaux).
   */
  private async sendFcmMobileChannels(args: {
    entityType: AdNotificationEntityTypeEnum;
    entityId: string;
    adId?: Types.ObjectId;
    campaignId?: Types.ObjectId;
    storeId: Types.ObjectId;
    storeName: string;
    title: string;
    body: string;
    recipient: RecipientRow;
    linkBase: Omit<Parameters<typeof buildAdNotificationAppDeepLink>[0], 'deliveryId'>;
    inApp: boolean;
    push: boolean;
  }): Promise<void> {
    const deliveryIdInApp = args.inApp ? randomUUID() : '';
    const deliveryIdPush = args.push ? randomUUID() : '';
    const fcmDeliveryId = args.push ? deliveryIdPush : deliveryIdInApp;

    let inboxNotificationId: string | undefined;
    if (args.inApp && deliveryIdInApp) {
      try {
        const inAppData = this.buildAdFcmData({
          deliveryId: deliveryIdInApp,
          entityType: args.entityType,
          entityId: args.entityId,
          storeId: args.storeId.toString(),
          storeName: args.storeName,
          title: args.title,
          linkBase: args.linkBase,
        });
        const created = await this.notifications.createUserScopedNotification({
          recipientUserId: args.recipient.userId,
          title: args.title,
          body: args.body,
          type: 'ad_promo',
          data: inAppData,
          sendPush: false,
        });
        inboxNotificationId = created.id;
      } catch (e) {
        this.logger.warn(
          `in-app ad inbox ${deliveryIdInApp}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    if (fcmDeliveryId) {
      try {
        const fcmData = this.buildAdFcmData({
          deliveryId: fcmDeliveryId,
          entityType: args.entityType,
          entityId: args.entityId,
          storeId: args.storeId.toString(),
          storeName: args.storeName,
          title: args.title,
          linkBase: args.linkBase,
        });
        if (inboxNotificationId) {
          fcmData.notificationId = inboxNotificationId;
        }
        const res = await this.notifications.sendMulticastNotification({
          recipientUserIds: [args.recipient.userId],
          title: args.title,
          body: args.body,
          data: fcmData,
          androidChannelId: this.adFcmAndroidChannelId(),
        });
        if (res.deviceCount === 0) {
          this.logger.warn(
            `ad FCM: aucun jeton pour l’utilisateur ${args.recipient.userId}`,
          );
        }
      } catch (e) {
        this.logger.warn(
          `ad FCM ${fcmDeliveryId}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    if (args.inApp && deliveryIdInApp) {
      await this.recordDelivery({
        deliveryId: deliveryIdInApp,
        entityType: args.entityType,
        adId: args.adId,
        campaignId: args.campaignId,
        storeId: args.storeId,
        userId: args.recipient.userId,
        channel: AdNotificationChannelEnum.IN_APP,
      });
    }
    if (args.push && deliveryIdPush) {
      await this.recordDelivery({
        deliveryId: deliveryIdPush,
        entityType: args.entityType,
        adId: args.adId,
        campaignId: args.campaignId,
        storeId: args.storeId,
        userId: args.recipient.userId,
        channel: AdNotificationChannelEnum.PUSH,
      });
    }
  }

  private async sendEmailChannel(args: {
    entityType: AdNotificationEntityTypeEnum;
    entityId: string;
    adId?: Types.ObjectId;
    campaignId?: Types.ObjectId;
    storeId: Types.ObjectId;
    storeName: string;
    title: string;
    body: string;
    recipient: RecipientRow;
    linkBase: Omit<Parameters<typeof buildAdNotificationWebOpenUrl>[0], 'deliveryId'>;
    deliveryId: string;
  }): Promise<void> {
    const webUrl = this.trackedClickUrl({
      deliveryId: args.deliveryId,
      entityType: args.entityType,
      entityId: args.entityId,
      storeId: args.storeId.toString(),
    });
    const html = `
      <p>Bonjour ${args.recipient.fullName},</p>
      <p><strong>${args.storeName}</strong> — ${args.title}</p>
      <p>${args.body}</p>
      <p><a href="${webUrl}" style="display:inline-block;padding:12px 20px;background:#7c3aed;color:#fff;text-decoration:none;border-radius:8px;">Voir l'offre</a></p>
    `;
    try {
      await this.mailer.sendAdNotificationEmail({
        to: args.recipient.email,
        toName: args.recipient.fullName,
        subject: `${args.storeName} — ${args.title}`,
        html,
        text: `${args.storeName} — ${args.title}\n${args.body}\n${webUrl}`,
      });
      await this.recordDelivery({
        deliveryId: args.deliveryId,
        entityType: args.entityType,
        adId: args.adId,
        campaignId: args.campaignId,
        storeId: args.storeId,
        userId: args.recipient.userId,
        channel: AdNotificationChannelEnum.EMAIL,
      });
    } catch (e) {
      this.logger.warn(
        `email ad notification ${args.deliveryId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private async sendWhatsappChannel(args: {
    entityType: AdNotificationEntityTypeEnum;
    entityId: string;
    adId?: Types.ObjectId;
    campaignId?: Types.ObjectId;
    storeId: Types.ObjectId;
    storeName: string;
    title: string;
    body: string;
    recipient: RecipientRow;
    linkBase: Omit<Parameters<typeof buildAdNotificationWebOpenUrl>[0], 'deliveryId'>;
    deliveryId: string;
  }): Promise<void> {
    const webUrl = this.trackedClickUrl({
      deliveryId: args.deliveryId,
      entityType: args.entityType,
      entityId: args.entityId,
      storeId: args.storeId.toString(),
    });
    const message =
      `${args.storeName} — ${args.title}\n${args.body}\n${webUrl}`.slice(0, 1600);
    const sent = await trySendAdWhatsApp({
      env: process.env,
      toPhone: args.recipient.phone,
      body: message,
    });
    if (!sent) {
      this.logger.debug(
        `WhatsApp ad notification (non envoyé / désactivé): ${args.recipient.phone}`,
      );
    }
    await this.recordDelivery({
      deliveryId: args.deliveryId,
      entityType: args.entityType,
      adId: args.adId,
      campaignId: args.campaignId,
      storeId: args.storeId,
      userId: args.recipient.userId,
      channel: AdNotificationChannelEnum.WHATSAPP,
    });
  }

  private async sendSmsChannel(args: {
    entityType: AdNotificationEntityTypeEnum;
    entityId: string;
    adId?: Types.ObjectId;
    campaignId?: Types.ObjectId;
    storeId: Types.ObjectId;
    storeName: string;
    title: string;
    body: string;
    recipient: RecipientRow;
    linkBase: Omit<Parameters<typeof buildAdNotificationWebOpenUrl>[0], 'deliveryId'>;
    deliveryId: string;
  }): Promise<void> {
    const webUrl = this.trackedClickUrl({
      deliveryId: args.deliveryId,
      entityType: args.entityType,
      entityId: args.entityId,
      storeId: args.storeId.toString(),
    });
    const message =
      `${args.storeName} — ${args.title}\n${args.body}\n${webUrl}`.slice(0, 1600);
    const sent = await trySendAdSms({
      env: process.env,
      toPhone: args.recipient.phone,
      body: message,
    });
    if (!sent) {
      this.logger.debug(
        `SMS ad notification (non envoyé / désactivé): ${args.recipient.phone}`,
      );
    }
    await this.recordDelivery({
      deliveryId: args.deliveryId,
      entityType: args.entityType,
      adId: args.adId,
      campaignId: args.campaignId,
      storeId: args.storeId,
      userId: args.recipient.userId,
      channel: AdNotificationChannelEnum.SMS,
    });
  }

  async trackEvent(dto: TrackAdNotificationEventDto): Promise<{ ok: true }> {
    const deliveryId = dto.deliveryId.trim();
    const doc = await this.eventModel.findOne({ deliveryId }).exec();
    if (!doc) {
      throw new NotFoundException('delivery_not_found');
    }
    const now = new Date();
    if (dto.event === TrackAdNotificationEventKindEnum.INTERACTION) {
      if (!doc.interactionAt) {
        doc.interactionAt = now;
        await doc.save();
      }
    } else if (dto.event === TrackAdNotificationEventKindEnum.CONVERSION) {
      if (!doc.interactionAt) {
        doc.interactionAt = now;
      }
      if (!doc.conversionAt) {
        doc.conversionAt = now;
      }
      await doc.save();
    }
    return { ok: true };
  }

  async recordClickAndResolveDeepLink(
    deliveryId: string,
  ): Promise<{ deepLink: string; webFallback: string }> {
    const doc = await this.eventModel.findOne({ deliveryId: deliveryId.trim() }).exec();
    if (!doc) {
      throw new NotFoundException('delivery_not_found');
    }
    if (!doc.interactionAt) {
      doc.interactionAt = new Date();
      await doc.save();
    }
    const entityId = String(doc.ad ?? doc.campaign ?? '');
    const entityType = doc.entityType;
    const storeId = String(doc.store);
    const deepLink = buildAdNotificationAppDeepLink({
      deliveryId: doc.deliveryId,
      entityType,
      entityId,
      storeId,
      webBaseUrl: this.webBaseUrl(),
      appScheme: this.appScheme(),
    });
    const webFallback = buildAdNotificationWebOpenUrl({
      deliveryId: doc.deliveryId,
      entityType,
      entityId,
      storeId,
      webBaseUrl: this.webBaseUrl(),
      appScheme: this.appScheme(),
    });
    return { deepLink, webFallback };
  }

  async aggregateMetricsForAd(
    adId: Types.ObjectId,
  ): Promise<AdNotificationBillingMetrics> {
    return this.aggregateMetrics({ ad: adId });
  }

  async aggregateMetricsForCampaign(
    campaignId: Types.ObjectId,
  ): Promise<AdNotificationBillingMetrics> {
    return this.aggregateMetrics({ campaign: campaignId });
  }

  private async aggregateMetrics(filter: {
    ad?: Types.ObjectId;
    campaign?: Types.ObjectId;
  }): Promise<AdNotificationBillingMetrics> {
    const match: Record<string, unknown> = {};
    if (filter.ad) match.ad = filter.ad;
    if (filter.campaign) match.campaign = filter.campaign;

    const rows = await this.eventModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$channel',
          deliveries: { $sum: 1 },
          interactions: {
            $sum: { $cond: [{ $ifNull: ['$interactionAt', false] }, 1, 0] },
          },
          conversions: {
            $sum: { $cond: [{ $ifNull: ['$conversionAt', false] }, 1, 0] },
          },
        },
      },
    ]);

    return aggregateNotificationBillingMetrics(
      rows.map((r) => ({
        channel: String(r._id ?? 'email') as
          | 'email'
          | 'push'
          | 'inApp'
          | 'sms'
          | 'whatsapp',
        deliveries: Number(r.deliveries ?? 0),
        interactions: Number(r.interactions ?? 0),
        conversions: Number(r.conversions ?? 0),
      })),
    );
  }

  computeNotificationAmount(
    metrics: AdNotificationBillingMetrics,
    pricing: AdNotificationPricingRates,
  ): number {
    return computeNotificationBillingAmountCad(metrics, pricing);
  }

  emptyNotificationMetrics(): AdNotificationBillingMetrics {
    return buildEmptyNotificationBillingMetrics();
  }
}
