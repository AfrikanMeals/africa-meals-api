import {
  BadRequestException,
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
import { parsePositiveInt } from '../../common/bullmq-redis-connection';
import { AdNotificationDispatchQueueService } from '@modules/ads/ad-notification-dispatch-queue.service';
import type {
  AdNotifyEntityJob,
  AdNotifyRecipientBatchJob,
} from '@modules/ads/ad-notification-dispatch.types';
import { MailerService } from '@modules/mailer/mailer.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import {
  applyChannelAvailabilityToAddon,
  parseAvailableChannelsFromDoc,
  type AdNotificationChannelAvailability,
} from '@modules/ads/ad-notification-channel-availability.util';
import {
  normalizeNotificationAddonInput,
  notificationAddonFromDoc,
  type NotificationAddonPayload,
} from '@modules/ads/ad-notification.util';
import {
  aggregateNotificationBillingMetrics,
  buildEmptyNotificationBillingMetrics,
  computeNotificationBillingAmountCad,
  type AdNotificationBillingMetrics,
  type AdNotificationChannelKey,
  type AdNotificationPricingRates,
} from '@modules/ads/ad-notification-billing.util';
import type {
  AdNotificationStatsChannelRow,
  AdNotificationStatsDayBucket,
  AdNotificationStatsPayload,
  AdNotificationStatsRecentRow,
} from '@modules/ads/ad-notification-stats.types';
import {
  buildAdNotificationAppDeepLink,
  buildAdNotificationWebOpenUrl,
} from '@modules/ads/ad-notification-link.util';
import { trySendAdSms } from '@modules/ads/twilio-sms.util';
import { trySendAdWhatsApp } from '@modules/ads/meta-whatsapp.util';
import {
  AdNotificationTestSourceEnum,
  SendAdNotificationTestDto,
} from '@modules/ads/dto/send-ad-notification-test.dto';
import { TrackAdNotificationEventDto, TrackAdNotificationEventKindEnum } from '@modules/ads/dto/ad-notification-tracking.dto';
import { StoreAccessService } from '@modules/teams/store-access.service';
import { AdModel } from '@schemas/ad.schema';
import { AdCampaignModel } from '@schemas/ad-campaign.schema';
import {
  AdNotificationChannelEnum,
  AdNotificationEntityTypeEnum,
  AdNotificationEventModel,
} from '@schemas/ad-notification-event.schema';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { AdNotificationPricingSettingsModel } from '@schemas/ad-notification-pricing-settings.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';

const AD_NOTIFICATION_PRICING_KEY = 'default';
const CHANNEL_AVAILABILITY_TTL_MS = 60_000;

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

type RecipientRow = {
  userId: string;
  email: string;
  phone: string;
  fullName: string;
};

@Injectable()
export class AdNotificationService {
  private readonly logger = new Logger(AdNotificationService.name);
  private channelAvailabilityCache: {
    at: number;
    channels: AdNotificationChannelAvailability;
  } | null = null;

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
    @InjectModel(AdNotificationPricingSettingsModel.name)
    private readonly notificationPricingModel: Model<AdNotificationPricingSettingsModel>,
    private readonly notifications: NotificationsService,
    private readonly mailer: MailerService,
    @Inject(forwardRef(() => AdNotificationDispatchQueueService))
    private readonly dispatchQueue: AdNotificationDispatchQueueService,
    private readonly storeAccess: StoreAccessService,
  ) {}

  private async assertAdminSettings(user: UserModel): Promise<void> {
    await this.storeAccess.assertAdminPermission(user, 'admin.settings');
  }

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

  private async loadAvailableChannels(): Promise<AdNotificationChannelAvailability> {
    const now = Date.now();
    if (
      this.channelAvailabilityCache &&
      now - this.channelAvailabilityCache.at < CHANNEL_AVAILABILITY_TTL_MS
    ) {
      return this.channelAvailabilityCache.channels;
    }
    const doc = await this.notificationPricingModel
      .findOne({ key: AD_NOTIFICATION_PRICING_KEY })
      .lean()
      .exec();
    const channels = parseAvailableChannelsFromDoc(
      doc as unknown as Record<string, unknown> | null,
    );
    this.channelAvailabilityCache = { at: now, channels };
    return channels;
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

  /** Point d’entrée cron : file BullMQ si Redis, sinon synchrone. */
  async runDispatchPass(): Promise<{
    bannersDispatched: number;
    campaignsDispatched: number;
  }> {
    if (this.dispatchQueue.isEnabled()) {
      return this.dispatchQueue.enqueuePendingDispatches();
    }
    return this.runDispatchPassSync();
  }

  /** Mode sans Redis — traitement entités en parallèle limité. */
  async runDispatchPassSync(): Promise<{
    bannersDispatched: number;
    campaignsDispatched: number;
  }> {
    const pending = await this.findPendingEntities();
    let bannersDispatched = 0;
    let campaignsDispatched = 0;
    await this.mapPool(pending.banners, 2, async (row) => {
      try {
        await this.processEntityDispatchJob({ kind: 'banner', entityId: String(row._id) });
        bannersDispatched++;
      } catch (e) {
        this.logger.warn(
          `dispatch banner ${row._id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });
    await this.mapPool(pending.campaigns, 2, async (row) => {
      try {
        await this.processEntityDispatchJob({
          kind: 'campaign',
          entityId: String(row._id),
        });
        campaignsDispatched++;
      } catch (e) {
        this.logger.warn(
          `dispatch campaign ${row._id}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });
    return { bannersDispatched, campaignsDispatched };
  }

  async enqueuePendingEntities(
    queue: Queue<AdNotifyEntityJob | AdNotifyRecipientBatchJob>,
    opts: {
      entityJobName: string;
      batchJobName: string;
      jobOpts: JobsOptions;
    },
  ): Promise<{ bannersDispatched: number; campaignsDispatched: number }> {
    const pending = await this.findPendingEntities();
    let bannersDispatched = 0;
    let campaignsDispatched = 0;
    await Promise.all(
      pending.banners.map(async (row) => {
        const id = String(row._id);
        await queue.add(
          opts.entityJobName,
          { kind: 'banner', entityId: id } satisfies AdNotifyEntityJob,
          { ...opts.jobOpts, jobId: `banner:${id}` },
        );
        bannersDispatched++;
      }),
    );
    await Promise.all(
      pending.campaigns.map(async (row) => {
        const id = String(row._id);
        await queue.add(
          opts.entityJobName,
          { kind: 'campaign', entityId: id } satisfies AdNotifyEntityJob,
          { ...opts.jobOpts, jobId: `campaign:${id}` },
        );
        campaignsDispatched++;
      }),
    );
    return { bannersDispatched, campaignsDispatched };
  }

  private notArchivedFilter() {
    return {
      $or: [{ archivedAt: { $exists: false } }, { archivedAt: null }],
    };
  }

  private notDispatchedFilter() {
    return {
      $or: [
        { notificationDispatchedAt: { $exists: false } },
        { notificationDispatchedAt: null },
      ],
    };
  }

  private bannerStartedFilter(now: Date) {
    return {
      $or: [
        { validFrom: { $exists: false } },
        { validFrom: null },
        { validFrom: { $lte: now } },
      ],
    };
  }

  private entityEligibilityFilter(
    now: Date,
    kind: AdNotifyEntityJob['kind'],
  ): Record<string, unknown> {
    const $and = [
      this.notArchivedFilter(),
      this.notDispatchedFilter(),
      ...(kind === 'banner' ? [this.bannerStartedFilter(now)] : []),
    ];
    if (kind === 'banner') {
      return {
        isActive: true,
        validUntil: { $gte: now },
        'notificationAddon.enabled': true,
        $and,
      };
    }
    return {
      isActive: true,
      startsAt: { $lte: now },
      endsAt: { $gte: now },
      'notificationAddon.enabled': true,
      $and,
    };
  }

  /** Vérifie si une entité peut être envoyée maintenant (cron ou enqueue immédiat). */
  async isEntityEligibleForDispatch(job: AdNotifyEntityJob): Promise<boolean> {
    if (!Types.ObjectId.isValid(job.entityId)) return false;
    const now = new Date();
    const id = new Types.ObjectId(job.entityId);
    const filter = {
      _id: id,
      ...this.entityEligibilityFilter(now, job.kind),
    };
    if (job.kind === 'banner') {
      const n = await this.adModel.countDocuments(filter);
      return n > 0;
    }
    const n = await this.campaignModel.countDocuments(filter);
    return n > 0;
  }

  /**
   * Après création / mise à jour d’une pub avec add-on actif — ne bloque pas la requête HTTP.
   */
  scheduleImmediateDispatch(job: AdNotifyEntityJob): void {
    void this.runImmediateDispatch(job);
  }

  private async runImmediateDispatch(job: AdNotifyEntityJob): Promise<void> {
    try {
      if (!(await this.isEntityEligibleForDispatch(job))) return;
      await this.dispatchQueue.enqueueEntityDispatch(job);
      this.logger.log(
        `Ad notification enqueue immédiat: ${job.kind} ${job.entityId}`,
      );
    } catch (e) {
      this.logger.warn(
        `Ad notification enqueue immédiat ${job.kind} ${job.entityId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  private async findPendingEntities(): Promise<{
    banners: Array<Record<string, unknown>>;
    campaigns: Array<Record<string, unknown>>;
  }> {
    const now = new Date();
    const pendingFilter = this.notDispatchedFilter();
    const [banners, campaigns] = await Promise.all([
      this.adModel
        .find({
          isActive: true,
          validUntil: { $gte: now },
          'notificationAddon.enabled': true,
          $and: [
            this.notArchivedFilter(),
            this.bannerStartedFilter(now),
            pendingFilter,
          ],
        })
        .select('_id store title subtitle notificationAddon audienceTotal')
        .limit(30)
        .lean()
        .exec(),
      this.campaignModel
        .find({
          isActive: true,
          startsAt: { $lte: now },
          endsAt: { $gte: now },
          'notificationAddon.enabled': true,
          $and: [this.notArchivedFilter(), pendingFilter],
        })
        .select('_id store title subtitle notificationAddon audienceTotal')
        .limit(30)
        .lean()
        .exec(),
    ]);
    return {
      banners: banners as Array<Record<string, unknown>>,
      campaigns: campaigns as Array<Record<string, unknown>>,
    };
  }

  /** Worker BullMQ : réserve l’entité puis enqueue des lots destinataires. */
  async processEntityDispatchJob(job: AdNotifyEntityJob): Promise<void> {
    const row = await this.claimEntityRow(job);
    if (!row) return;

    const addon = applyChannelAvailabilityToAddon(
      notificationAddonFromDoc(
        row.notificationAddon as Record<string, unknown>,
      ),
      await this.loadAvailableChannels(),
    );
    if (!addon.enabled) {
      this.logger.log(
        `ad notification ${job.kind} ${job.entityId}: aucun canal actif (admin ou add-on)`,
      );
      return;
    }

    const storeId = new Types.ObjectId(String(row.store));
    const entityId =
      job.kind === 'banner' ? String(row._id) : String(row._id);
    const cap =
      row.audienceTotal != null ? Math.floor(Number(row.audienceTotal)) : null;
    const recipients = await this.resolveStoreAudience(storeId, cap);
    const storeName = String(row.storeName ?? 'Restaurant');
    const title = String(row.title ?? (job.kind === 'banner' ? 'Offre' : 'Campagne'));
    const subtitle = String(row.subtitle ?? '').trim();
    const body =
      subtitle ||
      (job.kind === 'banner'
        ? `${storeName} a une nouvelle offre pour vous.`
        : `${storeName} : découvrez notre campagne.`);

    const entityType =
      job.kind === 'banner'
        ? AdNotificationEntityTypeEnum.BANNER
        : AdNotificationEntityTypeEnum.CAMPAIGN;

    const batchPayloadBase: Omit<AdNotifyRecipientBatchJob, 'recipients'> = {
      entityType,
      entityId,
      adId: job.kind === 'banner' ? entityId : undefined,
      campaignId: job.kind === 'campaign' ? entityId : undefined,
      storeId: storeId.toString(),
      storeName,
      title,
      body,
      addon,
    };

    if (!recipients.length) {
      this.logger.log(`ad notification ${entityType} ${entityId}: audience vide`);
      return;
    }

    const batchSize = this.recipientBatchSize();
    for (let i = 0; i < recipients.length; i += batchSize) {
      const slice = recipients.slice(i, i + batchSize);
      const payload: AdNotifyRecipientBatchJob = {
        ...batchPayloadBase,
        recipients: slice,
      };
      if (this.dispatchQueue.isEnabled()) {
        await this.dispatchQueue.enqueueRecipientBatch(payload);
      } else {
        await this.processRecipientBatchJob(payload);
      }
    }
  }

  private async claimEntityRow(
    job: AdNotifyEntityJob,
  ): Promise<Record<string, unknown> | null> {
    const now = new Date();
    const id = new Types.ObjectId(job.entityId);
    if (job.kind === 'banner') {
      const doc = await this.adModel
        .findOneAndUpdate(
          {
            _id: id,
            ...this.entityEligibilityFilter(now, 'banner'),
          },
          { $set: { notificationDispatchedAt: now } },
          { new: true, lean: true },
        )
        .select('_id store title subtitle notificationAddon audienceTotal')
        .exec();
      if (!doc) return null;
      const store = await this.storeModel
        .findById(doc.store)
        .select('name')
        .lean()
        .exec();
      return {
        ...(doc as Record<string, unknown>),
        storeName: (store as { name?: string } | null)?.name,
      };
    }

    const doc = await this.campaignModel
      .findOneAndUpdate(
        {
          _id: id,
          ...this.entityEligibilityFilter(now, 'campaign'),
        },
        { $set: { notificationDispatchedAt: now } },
        { new: true, lean: true },
      )
      .select('_id store title subtitle notificationAddon audienceTotal')
      .exec();
    if (!doc) return null;
    const store = await this.storeModel
      .findById(doc.store)
      .select('name')
      .lean()
      .exec();
    return {
      ...(doc as Record<string, unknown>),
      storeName: (store as { name?: string } | null)?.name,
    };
  }

  /** Worker BullMQ : envoi par lot (FCM groupé + canaux en parallèle limité). */
  async processRecipientBatchJob(
    job: AdNotifyRecipientBatchJob,
  ): Promise<void> {
    const storeId = new Types.ObjectId(job.storeId);
    const adId = job.adId ? new Types.ObjectId(job.adId) : undefined;
    const campaignId = job.campaignId
      ? new Types.ObjectId(job.campaignId)
      : undefined;

    await this.sendRecipientBatch({
      entityType: job.entityType,
      entityId: job.entityId,
      adId,
      campaignId,
      storeId,
      storeName: job.storeName,
      title: job.title,
      body: job.body,
      addon: job.addon,
      recipients: job.recipients,
    });
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

  private async sendRecipientBatch(args: {
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
    if (!args.recipients.length) return;

    const linkBase = {
      entityType: args.entityType,
      entityId: args.entityId,
      storeId: args.storeId.toString(),
      webBaseUrl: this.webBaseUrl(),
      appScheme: this.appScheme(),
    };

    await this.mapPool(
      args.recipients,
      this.recipientParallel(),
      async (recipient) => {
        await this.sendToRecipient({ ...args, recipient, linkBase });
      },
    );
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
    linkBase: Omit<Parameters<typeof buildAdNotificationAppDeepLink>[0], 'deliveryId'>;
  }): Promise<void> {
    const { addon, recipient, linkBase } = args;

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
    await this.recordDeliveriesBulk([args]);
  }

  private async recordDeliveriesBulk(
    rows: Array<{
      deliveryId: string;
      entityType: AdNotificationEntityTypeEnum;
      adId?: Types.ObjectId;
      campaignId?: Types.ObjectId;
      storeId: Types.ObjectId;
      userId: string;
      channel: AdNotificationChannelEnum;
    }>,
  ): Promise<void> {
    if (!rows.length) return;
    const now = new Date();
    await this.eventModel.insertMany(
      rows.map((r) => ({
        deliveryId: r.deliveryId,
        entityType: r.entityType,
        ad: r.adId,
        campaign: r.campaignId,
        store: r.storeId,
        user: new Types.ObjectId(r.userId),
        channel: r.channel,
        deliveredAt: now,
      })),
      { ordered: false },
    );
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

    const deliveryRows: Array<{
      deliveryId: string;
      entityType: AdNotificationEntityTypeEnum;
      adId?: Types.ObjectId;
      campaignId?: Types.ObjectId;
      storeId: Types.ObjectId;
      userId: string;
      channel: AdNotificationChannelEnum;
    }> = [];
    if (args.inApp && deliveryIdInApp) {
      deliveryRows.push({
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
      deliveryRows.push({
        deliveryId: deliveryIdPush,
        entityType: args.entityType,
        adId: args.adId,
        campaignId: args.campaignId,
        storeId: args.storeId,
        userId: args.recipient.userId,
        channel: AdNotificationChannelEnum.PUSH,
      });
    }
    await this.recordDeliveriesBulk(deliveryRows);
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
    const sent = await trySendAdWhatsApp({
      env: process.env,
      toPhone: args.recipient.phone,
      storeName: args.storeName,
      title: args.title,
      body: args.body,
      webUrl,
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

  async buildStatsForAd(
    adId: Types.ObjectId,
    addonEnabled: boolean,
  ): Promise<AdNotificationStatsPayload> {
    return this.buildStatsPayload({ ad: adId }, addonEnabled);
  }

  async buildStatsForCampaign(
    campaignId: Types.ObjectId,
    addonEnabled: boolean,
  ): Promise<AdNotificationStatsPayload> {
    return this.buildStatsPayload({ campaign: campaignId }, addonEnabled);
  }

  private static ratePercent(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Math.round((numerator / denominator) * 10000) / 100;
  }

  private async buildStatsPayload(
    filter: { ad?: Types.ObjectId; campaign?: Types.ObjectId },
    addonEnabled: boolean,
  ): Promise<AdNotificationStatsPayload> {
    const match: Record<string, unknown> = {};
    if (filter.ad) match.ad = filter.ad;
    if (filter.campaign) match.campaign = filter.campaign;

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 6);
    since.setUTCHours(0, 0, 0, 0);

    const [metrics, byDay, recentDocs] = await Promise.all([
      this.aggregateMetrics(filter),
      this.eventModel
        .aggregate<{
          _id: string;
          deliveries: number;
          interactions: number;
          conversions: number;
        }>([
          { $match: { ...match, deliveredAt: { $gte: since } } },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$deliveredAt',
                  timezone: 'UTC',
                },
              },
              deliveries: { $sum: 1 },
              interactions: {
                $sum: {
                  $cond: [{ $ifNull: ['$interactionAt', false] }, 1, 0],
                },
              },
              conversions: {
                $sum: {
                  $cond: [{ $ifNull: ['$conversionAt', false] }, 1, 0],
                },
              },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .exec(),
      this.eventModel
        .find(match)
        .sort({ deliveredAt: -1 })
        .limit(60)
        .select('deliveryId channel deliveredAt interactionAt conversionAt')
        .lean()
        .exec(),
    ]);

    const channelKeys: AdNotificationChannelKey[] = [
      'email',
      'push',
      'inApp',
      'sms',
      'whatsapp',
    ];
    const channels: AdNotificationStatsChannelRow[] = channelKeys.map(
      (channel) => {
        const slot = metrics.byChannel[channel];
        const deliveries = slot?.deliveries ?? 0;
        const interactions = slot?.interactions ?? 0;
        const conversions = slot?.conversions ?? 0;
        return {
          channel,
          deliveries,
          interactions,
          conversions,
          interactionRatePercent: AdNotificationService.ratePercent(
            interactions,
            deliveries,
          ),
          conversionRatePercent: AdNotificationService.ratePercent(
            conversions,
            interactions,
          ),
        };
      },
    );

    const last7Days: AdNotificationStatsDayBucket[] = byDay.map((d) => ({
      date: d._id,
      deliveries: d.deliveries,
      interactions: d.interactions,
      conversions: d.conversions,
    }));

    const recentDeliveries: AdNotificationStatsRecentRow[] = recentDocs.map(
      (row) => {
        const r = row as Record<string, unknown>;
        const deliveredAt = r.deliveredAt as Date | string | undefined;
        const interactionAt = r.interactionAt as Date | string | null | undefined;
        const conversionAt = r.conversionAt as Date | string | null | undefined;
        const toIso = (v: Date | string | null | undefined): string | null => {
          if (v == null) return null;
          return v instanceof Date ? v.toISOString() : String(v);
        };
        return {
          deliveryId: String(r.deliveryId ?? ''),
          channel: String(r.channel ?? 'email') as AdNotificationChannelKey,
          deliveredAt:
            deliveredAt instanceof Date
              ? deliveredAt.toISOString()
              : String(deliveredAt ?? new Date()),
          interactionAt: toIso(interactionAt),
          conversionAt: toIso(conversionAt),
        };
      },
    );

    const deliveriesTotal = metrics.totalDeliveries;
    const interactionsTotal = metrics.totalInteractions;
    const conversionsTotal = metrics.totalConversions;

    return {
      addonEnabled,
      deliveriesTotal,
      interactionsTotal,
      conversionsTotal,
      interactionRatePercent: AdNotificationService.ratePercent(
        interactionsTotal,
        deliveriesTotal,
      ),
      conversionRatePercent: AdNotificationService.ratePercent(
        conversionsTotal,
        interactionsTotal,
      ),
      channels,
      last7Days,
      recentDeliveries,
    };
  }

  /** Contexte admin — canaux actifs + entités pub avec add-on notifications. */
  async getAdminTestContext(user: UserModel): Promise<{
    availableChannels: AdNotificationChannelAvailability;
    banners: Array<{
      id: string;
      storeId: string;
      storeName: string;
      title: string;
      channels: NotificationAddonPayload['channels'];
    }>;
    campaigns: Array<{
      id: string;
      storeId: string;
      storeName: string;
      title: string;
      channels: NotificationAddonPayload['channels'];
    }>;
  }> {
    await this.assertAdminSettings(user);
    const available = await this.loadAvailableChannels();
    const [bannerDocs, campaignDocs] = await Promise.all([
      this.adModel
        .find({ 'notificationAddon.enabled': true })
        .select('_id store title notificationAddon')
        .sort({ updatedAt: -1 })
        .limit(40)
        .lean()
        .exec(),
      this.campaignModel
        .find({ 'notificationAddon.enabled': true })
        .select('_id store title notificationAddon')
        .sort({ updatedAt: -1 })
        .limit(40)
        .lean()
        .exec(),
    ]);
    const storeIds = [
      ...new Set(
        [...bannerDocs, ...campaignDocs]
          .map((d) => String((d as { store?: unknown }).store ?? ''))
          .filter((id) => Types.ObjectId.isValid(id)),
      ),
    ];
    const stores = storeIds.length
      ? await this.storeModel
          .find({ _id: { $in: storeIds } })
          .select('name')
          .lean()
          .exec()
      : [];
    const storeNames = new Map(
      stores.map((s) => [
        String((s as { _id?: unknown })._id),
        String((s as { name?: string }).name ?? 'Boutique'),
      ]),
    );
    const mapEntity = (doc: Record<string, unknown>) => {
      const addon = notificationAddonFromDoc(
        doc.notificationAddon as Record<string, unknown>,
      );
      const storeId = String(doc.store ?? '');
      return {
        id: String(doc._id ?? ''),
        storeId,
        storeName: storeNames.get(storeId) ?? 'Boutique',
        title: String(doc.title ?? 'Offre'),
        channels: addon.channels,
      };
    };
    return {
      availableChannels: available,
      banners: bannerDocs.map((d) =>
        mapEntity(d as Record<string, unknown>),
      ),
      campaigns: campaignDocs.map((d) =>
        mapEntity(d as Record<string, unknown>),
      ),
    };
  }

  /** Envoi test admin vers un seul utilisateur (sans marquer la pub comme dispatchée). */
  async sendAdminTest(
    user: UserModel,
    dto: SendAdNotificationTestDto,
  ): Promise<{
    ok: boolean;
    userId: string;
    email: string;
    phone: string;
    fullName: string;
    entityType: AdNotificationEntityTypeEnum;
    entityId: string;
    storeId: string;
    storeName: string;
    title: string;
    body: string;
    channelsRequested: string[];
    message: string;
  }> {
    await this.assertAdminSettings(user);
    const targetUserId = dto.targetUserId?.trim();
    const targetEmail = dto.targetEmail?.trim().toLowerCase();
    if (!targetUserId && !targetEmail) {
      throw new BadRequestException('target_user_required');
    }
    if (targetUserId && targetEmail) {
      throw new BadRequestException('target_user_ambiguous');
    }

    const recipientUser = targetUserId
      ? await this.userModel.findById(targetUserId).exec()
      : await this.userModel
          .findOne({ email: targetEmail })
          .exec();
    if (!recipientUser) {
      throw new NotFoundException('user_not_found');
    }

    const available = await this.loadAvailableChannels();
    const addon = applyChannelAvailabilityToAddon(
      normalizeNotificationAddonInput(
        { enabled: true, channels: dto.channels },
        available,
      ),
      available,
    );
    if (!addon.enabled) {
      throw new BadRequestException('no_notification_channel_selected');
    }

    const channelsRequested = (
      Object.entries(addon.channels) as Array<[string, boolean]>
    )
      .filter(([, on]) => on)
      .map(([k]) => k);

    const payload = await this.resolveAdminTestPayload(dto);
    const recipient = this.userToRecipientRow(recipientUser);

    await this.sendRecipientBatch({
      entityType: payload.entityType,
      entityId: payload.entityId,
      adId: payload.adId,
      campaignId: payload.campaignId,
      storeId: payload.storeId,
      storeName: payload.storeName,
      title: payload.title,
      body: payload.body,
      addon,
      recipients: [recipient],
    });

    this.logger.log(
      `[ad-notification-test] admin=${String(user._id)} → user=${recipient.userId} channels=${channelsRequested.join(',')} entity=${payload.entityType}/${payload.entityId}`,
    );

    return {
      ok: true,
      userId: recipient.userId,
      email: recipient.email,
      phone: recipient.phone,
      fullName: recipient.fullName,
      entityType: payload.entityType,
      entityId: payload.entityId,
      storeId: payload.storeId.toString(),
      storeName: payload.storeName,
      title: payload.title,
      body: payload.body,
      channelsRequested,
      message:
        'Envoi terminé. Vérifiez la boîte mail, l’app (in-app / push) ou les logs API.',
    };
  }

  private userToRecipientRow(user: UserModel): RecipientRow {
    const raw = user as unknown as Record<string, unknown>;
    return {
      userId: String(user._id),
      email: String(raw.email ?? '')
        .trim()
        .toLowerCase(),
      phone: String(raw.phoneNumber ?? raw.phone ?? '').trim(),
      fullName: String(raw.fullName ?? '').trim() || 'Client',
    };
  }

  private async resolveAdminTestPayload(
    dto: SendAdNotificationTestDto,
  ): Promise<{
    entityType: AdNotificationEntityTypeEnum;
    entityId: string;
    adId?: Types.ObjectId;
    campaignId?: Types.ObjectId;
    storeId: Types.ObjectId;
    storeName: string;
    title: string;
    body: string;
  }> {
    if (dto.source === AdNotificationTestSourceEnum.SANDBOX) {
      const storeIdRaw = dto.storeId?.trim();
      if (!storeIdRaw || !Types.ObjectId.isValid(storeIdRaw)) {
        throw new BadRequestException('store_id_required');
      }
      const store = await this.storeModel
        .findById(storeIdRaw)
        .select('name')
        .lean()
        .exec();
      if (!store) {
        throw new NotFoundException('store_not_found');
      }
      const storeName = String((store as { name?: string }).name ?? 'Boutique');
      const title =
        dto.title?.trim() || `[Test] Offre — ${storeName}`;
      const body =
        dto.body?.trim() ||
        'Notification de test envoyée depuis l’admin (Integrity Check).';
      const entityId = `sandbox-${randomUUID()}`;
      return {
        entityType: AdNotificationEntityTypeEnum.BANNER,
        entityId,
        storeId: new Types.ObjectId(storeIdRaw),
        storeName,
        title: title.slice(0, 120),
        body: body.slice(0, 500),
      };
    }

    if (dto.source === AdNotificationTestSourceEnum.BANNER) {
      const id = dto.bannerId?.trim();
      if (!id || !Types.ObjectId.isValid(id)) {
        throw new BadRequestException('banner_id_required');
      }
      const doc = await this.adModel
        .findById(id)
        .select('_id store title subtitle notificationAddon')
        .lean()
        .exec();
      if (!doc) {
        throw new NotFoundException('banner_not_found');
      }
      const store = await this.storeModel
        .findById(doc.store)
        .select('name')
        .lean()
        .exec();
      const storeName = String((store as { name?: string })?.name ?? 'Boutique');
      const subtitle = String(doc.subtitle ?? '').trim();
      return {
        entityType: AdNotificationEntityTypeEnum.BANNER,
        entityId: String(doc._id),
        adId: doc._id as Types.ObjectId,
        storeId: new Types.ObjectId(String(doc.store)),
        storeName,
        title: (dto.title?.trim() || String(doc.title ?? 'Offre')).slice(0, 120),
        body: (
          dto.body?.trim() ||
          subtitle ||
          `${storeName} a une nouvelle offre pour vous.`
        ).slice(0, 500),
      };
    }

    if (dto.source === AdNotificationTestSourceEnum.CAMPAIGN) {
      const id = dto.campaignId?.trim();
      if (!id || !Types.ObjectId.isValid(id)) {
        throw new BadRequestException('campaign_id_required');
      }
      const doc = await this.campaignModel
        .findById(id)
        .select('_id store title subtitle notificationAddon')
        .lean()
        .exec();
      if (!doc) {
        throw new NotFoundException('campaign_not_found');
      }
      const store = await this.storeModel
        .findById(doc.store)
        .select('name')
        .lean()
        .exec();
      const storeName = String((store as { name?: string })?.name ?? 'Boutique');
      const subtitle = String(doc.subtitle ?? '').trim();
      return {
        entityType: AdNotificationEntityTypeEnum.CAMPAIGN,
        entityId: String(doc._id),
        campaignId: doc._id as Types.ObjectId,
        storeId: new Types.ObjectId(String(doc.store)),
        storeName,
        title: (dto.title?.trim() || String(doc.title ?? 'Campagne')).slice(
          0,
          120,
        ),
        body: (
          dto.body?.trim() ||
          subtitle ||
          `${storeName} : découvrez notre campagne.`
        ).slice(0, 500),
      };
    }

    throw new BadRequestException('invalid_test_source');
  }
}

export type {
  AdNotificationStatsChannelRow,
  AdNotificationStatsDayBucket,
  AdNotificationStatsPayload,
  AdNotificationStatsRecentRow,
} from '@modules/ads/ad-notification-stats.types';
