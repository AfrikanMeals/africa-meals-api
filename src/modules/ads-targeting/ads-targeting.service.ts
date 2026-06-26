import { CACHE_MANAGER } from '@nestjs/cache-manager';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { AdsService } from '@modules/ads/ads.service';
import { SearchSettingsService } from '@modules/search-settings/search-settings.service';
import { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';
import { shouldEmitLegacyAdWsFromApi } from '@modules/domain-event-handlers/domain-event-handlers.util';
import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import {
  CreateAdCampaignDto,
  PatchAdCampaignDto,
} from '@modules/ads/dto/ad-campaign.dto';
import { WsAdsTargetingNotifyService } from '@modules/ws-notify/ws-ads-targeting-notify.service';
import { AdCampaignModel } from '@schemas/ad-campaign.schema';
import { AdsTargetingAuditLogModel } from '@schemas/ads-targeting-audit-log.schema';
import {
  AdsTargetingEventModel,
  AdsTargetingEventTypeEnum,
} from '@schemas/ads-targeting-event.schema';
import { AdsTargetingProfileModel } from '@schemas/ads-targeting-profile.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Cache } from 'cache-manager';
import { Model } from 'mongoose';
import {
  AdsTargetingEventDto,
  AdsTargetingIngestDto,
} from './dto/ads-targeting.dto';
import {
  buildPlacementWithSlot,
  computeDeliveryConversionBoost,
  computePlacementPerformanceBoost,
  computePositionBoost,
  expandPlacementKeys,
  matchesPlacementRules,
  placementMatchScore,
  readEditorialPriority,
  readPreferredSlot,
  type CampaignPlacementStats,
} from './ads-targeting-placement.util';
import { computeAdsTargetingScore } from './ads-targeting-scoring';

type InterestScores = Record<string, number>;

type RecommendResult = {
  ad_id: string;
  campaign_id: string;
  creative_url: string;
  cta: string;
  relevance_score: number;
  targeting_reason: string;
};

@Injectable()
export class AdsTargetingService {
  private readonly logger = new Logger(AdsTargetingService.name);
  private readonly queue: AdsTargetingEventDto[] = [];
  private queueProcessing = false;

  constructor(
    @InjectModel(AdsTargetingEventModel.name)
    private readonly eventModel: Model<AdsTargetingEventModel>,
    @InjectModel(AdsTargetingProfileModel.name)
    private readonly profileModel: Model<AdsTargetingProfileModel>,
    @InjectModel(AdsTargetingAuditLogModel.name)
    private readonly auditLogModel: Model<AdsTargetingAuditLogModel>,
    @InjectModel(AdCampaignModel.name)
    private readonly campaignModel: Model<AdCampaignModel>,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @Inject(AdsService) private readonly adsService: AdsService,
    @Inject(SubscriptionsService)
    private readonly subscriptionsService: SubscriptionsService,
    @Inject(SearchSettingsService)
    private readonly searchSettingsService: SearchSettingsService,
    @Inject(WsAdsTargetingNotifyService)
    private readonly wsAdsTargetingNotify: WsAdsTargetingNotifyService,
    private readonly config: ConfigService,
    private readonly cronMonitor: CronMonitorService,
  ) {}

  private actorKey(user: UserModel | undefined | null): string {
    if (!user?._id) return 'anonymous';
    return String(user._id);
  }

  private retentionDays(): number {
    const raw = Number(process.env.ADS_TARGETING_DATA_RETENTION_DAYS ?? 90);
    if (!Number.isFinite(raw)) return 90;
    return Math.max(7, Math.min(365, Math.round(raw)));
  }

  private normalizeUserKey(
    event: AdsTargetingEventDto,
    user?: UserModel | null,
  ): string {
    const byEvent = String(event.userId ?? '').trim();
    if (byEvent) return byEvent;
    if (user?._id) return String(user._id);
    return `device:${event.deviceId.trim()}`;
  }

  private async logAccess(input: {
    action: string;
    actorKey: string;
    targetUserKey?: string;
    targetCampaignId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.auditLogModel.create(input).catch(() => undefined);
  }

  private ensureCanReadUserProfile(
    requester: UserModel | null | undefined,
    userKey: string,
  ): void {
    if (!requester) throw new ForbiddenException('unauthorized');
    if (requester.type === UserTypeEnum.ADMIN) return;
    if (String(requester._id) === userKey) return;
    throw new ForbiddenException('permission_denied');
  }

  private ensureCanEraseUserData(
    requester: UserModel | null | undefined,
    userKey: string,
  ): void {
    if (!requester) throw new ForbiddenException('unauthorized');
    if (requester.type === UserTypeEnum.ADMIN) return;
    if (String(requester._id) === userKey) return;
    throw new ForbiddenException('permission_denied');
  }

  private ensureAdmin(requester: UserModel | null | undefined): void {
    if (!requester || requester.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
  }

  private publishTargetingAdEngagementEvents(
    events: AdsTargetingEventDto[],
  ): void {
    if (shouldEmitLegacyAdWsFromApi(this.config)) return;
    for (const event of events) {
      const adId = String(event.adId ?? '').trim();
      if (!adId) continue;
      if (event.eventType === AdsTargetingEventTypeEnum.AD_IMPRESSION) {
        void this.adsService.publishAdEngagement('ad.impression', {
          adId,
          customerUserId: event.userId?.trim(),
          clientInstallId: event.deviceId?.trim(),
          adScope: 'BANNER',
        });
      } else if (event.eventType === AdsTargetingEventTypeEnum.AD_CLICK) {
        void this.adsService.publishAdEngagement('ad.click', {
          adId,
          customerUserId: event.userId?.trim(),
          clientInstallId: event.deviceId?.trim(),
          adScope: 'BANNER',
        });
      }
    }
  }

  private triggerQueueProcessing(): void {
    if (this.queueProcessing) return;
    this.queueProcessing = true;
    setTimeout(() => {
      void this.processQueue();
    }, 0);
  }

  private weightForEventType(type: AdsTargetingEventTypeEnum): number {
    switch (type) {
      case AdsTargetingEventTypeEnum.PURCHASE:
        return 4;
      case AdsTargetingEventTypeEnum.ITEM_LIKE:
        return 3;
      case AdsTargetingEventTypeEnum.ITEM_CLICK:
      case AdsTargetingEventTypeEnum.AD_CLICK:
        return 2;
      case AdsTargetingEventTypeEnum.ITEM_DISLIKE:
        return -2;
      case AdsTargetingEventTypeEnum.SEARCH_QUERY:
        return 1.5;
      case AdsTargetingEventTypeEnum.ITEM_VIEW:
      case AdsTargetingEventTypeEnum.CATEGORY_BROWSE:
      case AdsTargetingEventTypeEnum.AD_IMPRESSION:
        return 1;
      default:
        return 0;
    }
  }

  private segmentFromProfile(input: {
    now: Date;
    firstSeen: Date | null;
    lastActive: Date | null;
    engagementRate: number;
    sessions30d: number;
    viewsCount: number;
    clicksCount: number;
    purchases30d: number;
    discountedClicks: number;
  }): string {
    const {
      now,
      firstSeen,
      lastActive,
      engagementRate,
      sessions30d,
      viewsCount,
      clicksCount,
      purchases30d,
      discountedClicks,
    } = input;
    if (lastActive) {
      const idleDays = (now.getTime() - lastActive.getTime()) / 86_400_000;
      if (idleDays >= 14) return 'churned_risk';
    }
    if (engagementRate >= 0.45 && purchases30d > 0) return 'high_intent_buyer';
    if (
      discountedClicks > 0 &&
      discountedClicks >= Math.ceil(clicksCount * 0.6)
    ) {
      return 'deal_seeker';
    }
    if (viewsCount >= 15 && clicksCount <= 3) return 'window_shopper';
    if (sessions30d >= 10) return 'loyal_user';
    if (firstSeen) {
      const ageDays = (now.getTime() - firstSeen.getTime()) / 86_400_000;
      if (ageDays < 7) return 'new_user';
    }
    return 'window_shopper';
  }

  private async rebuildProfile(userKey: string): Promise<void> {
    const retentionMs = this.retentionDays() * 86_400_000;
    const from = new Date(Date.now() - retentionMs);
    const events = await this.eventModel
      .find({ userKey, timestamp: { $gte: from } })
      .sort({ timestamp: 1 })
      .lean()
      .exec();

    if (!events.length) {
      await this.profileModel
        .findOneAndUpdate(
          { userKey },
          {
            $set: {
              topCategories: [],
              interestScores: {},
              engagementRate: 0,
              lastActive: null,
              segment: 'new_user',
              country: null,
              language: null,
              conversionProbability: 0,
              sessions30d: 0,
              lastComputedAt: new Date(),
            },
          },
          { upsert: true, new: true },
        )
        .exec();
      return;
    }

    const scores = new Map<string, number>();
    let viewsCount = 0;
    let clicksCount = 0;
    let purchasesCount = 0;
    let discountedClicks = 0;
    let lastActive: Date | null = null;
    let country = '';
    let language = '';
    const now = new Date();
    const sessions30d = new Set<string>();
    const from30d = now.getTime() - 30 * 86_400_000;

    for (const row of events) {
      const eventType = row.eventType as AdsTargetingEventTypeEnum;
      const category = String(row.category ?? '')
        .trim()
        .toLowerCase();
      const timestamp = new Date(row.timestamp as unknown as string | Date);
      if (!lastActive || timestamp.getTime() > lastActive.getTime()) {
        lastActive = timestamp;
      }
      if (timestamp.getTime() >= from30d && row.sessionId) {
        sessions30d.add(String(row.sessionId));
      }
      if (row.country) country = String(row.country).trim().toUpperCase();
      if (row.metadata && typeof row.metadata === 'object') {
        const lang = (row.metadata as Record<string, unknown>).language;
        if (typeof lang === 'string' && lang.trim())
          language = lang.trim().toLowerCase();
      }
      if (
        eventType === AdsTargetingEventTypeEnum.ITEM_VIEW ||
        eventType === AdsTargetingEventTypeEnum.CATEGORY_BROWSE ||
        eventType === AdsTargetingEventTypeEnum.AD_IMPRESSION
      ) {
        viewsCount += 1;
      }
      if (
        eventType === AdsTargetingEventTypeEnum.ITEM_CLICK ||
        eventType === AdsTargetingEventTypeEnum.AD_CLICK ||
        eventType === AdsTargetingEventTypeEnum.ITEM_LIKE
      ) {
        clicksCount += 1;
      }
      if (eventType === AdsTargetingEventTypeEnum.PURCHASE) {
        purchasesCount += 1;
      }
      const discounted = (row.metadata as Record<string, unknown> | undefined)
        ?.discounted;
      if (
        discounted === true &&
        eventType === AdsTargetingEventTypeEnum.ITEM_CLICK
      ) {
        discountedClicks += 1;
      }
      if (category) {
        const next =
          (scores.get(category) ?? 0) + this.weightForEventType(eventType);
        scores.set(category, Number(next.toFixed(4)));
      }
    }

    const positiveScores = [...scores.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    const topCategories = positiveScores.slice(0, 5).map(([k]) => k);
    const totalPositive = positiveScores.reduce((s, [, v]) => s + v, 0) || 1;
    const interestScores: InterestScores = {};
    for (const [k, v] of positiveScores) {
      interestScores[k] = Number((v / totalPositive).toFixed(4));
    }

    const engagementRate = Number(
      (clicksCount / Math.max(1, clicksCount + viewsCount)).toFixed(4),
    );
    const conversionProbability = Number(
      (purchasesCount / Math.max(1, viewsCount + clicksCount)).toFixed(4),
    );
    const firstSeen = new Date(events[0].timestamp as unknown as string | Date);
    const segment = this.segmentFromProfile({
      now,
      firstSeen: Number.isNaN(firstSeen.getTime()) ? null : firstSeen,
      lastActive,
      engagementRate,
      sessions30d: sessions30d.size,
      viewsCount,
      clicksCount,
      purchases30d: purchasesCount,
      discountedClicks,
    });

    await this.profileModel
      .findOneAndUpdate(
        { userKey },
        {
          $set: {
            topCategories,
            interestScores,
            engagementRate,
            lastActive,
            segment,
            country: country || null,
            language: language || null,
            conversionProbability,
            sessions30d: sessions30d.size,
            lastComputedAt: new Date(),
          },
        },
        { upsert: true, new: true },
      )
      .exec();
  }

  private async processQueue(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const chunk = this.queue.splice(0, 250);
        const docs = chunk.map((event) => ({
          userKey:
            String(event.userId ?? '').trim() ||
            `device:${event.deviceId.trim()}`,
          deviceId: event.deviceId.trim(),
          sessionId: event.sessionId.trim(),
          appVersion: event.appVersion.trim(),
          os: event.os.trim(),
          eventType: event.eventType,
          itemId: event.itemId?.trim() || undefined,
          category: event.category?.trim().toLowerCase() || undefined,
          adId: event.adId?.trim() || undefined,
          campaignId: event.campaignId?.trim() || undefined,
          placement: event.placement?.trim() || undefined,
          country: event.country?.trim().toUpperCase() || undefined,
          metadata: event.metadata ?? {},
          timestamp: new Date(event.timestamp),
        }));
        await this.eventModel.insertMany(docs, { ordered: false });
        const uniqueUserKeys = [
          ...new Set(docs.map((d) => d.userKey).filter(Boolean)),
        ];
        await Promise.all(
          uniqueUserKeys.map((userKey) => this.rebuildProfile(userKey)),
        );
      }
    } catch (e) {
      this.logger.warn(
        `ads targeting queue processing failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    } finally {
      this.queueProcessing = false;
      if (this.queue.length > 0) this.triggerQueueProcessing();
    }
  }

  async ingest(
    requester: UserModel | null | undefined,
    dto: AdsTargetingIngestDto,
  ): Promise<{ received: number; queued: number }> {
    const received = dto.events.length;
    if (dto.consentGiven === false) {
      return { received, queued: 0 };
    }
    const normalized = dto.events.map((event) => ({
      ...event,
      userId: this.normalizeUserKey(event, requester),
    }));
    this.queue.push(...normalized);
    this.triggerQueueProcessing();
    this.publishTargetingAdEngagementEvents(normalized);
    if (shouldEmitLegacyAdWsFromApi(this.config)) {
      this.wsAdsTargetingNotify.broadcastEventIngested({
        received,
        queued: normalized.length,
        eventType: normalized[0]?.eventType ?? 'unknown',
        placement: normalized[0]?.placement ?? null,
      });
    }
    await this.logAccess({
      action: 'events_ingest',
      actorKey: this.actorKey(requester),
      metadata: { received, queued: normalized.length },
    });
    return { received, queued: normalized.length };
  }

  async getUserProfile(
    requester: UserModel | null | undefined,
    userKey: string,
  ): Promise<Record<string, unknown>> {
    const key = userKey.trim();
    this.ensureCanReadUserProfile(requester, key);
    let profile = await this.profileModel
      .findOne({ userKey: key })
      .lean()
      .exec();
    const stale =
      !profile ||
      !profile.lastComputedAt ||
      Date.now() - new Date(profile.lastComputedAt).getTime() > 60_000;
    if (stale) {
      await this.rebuildProfile(key);
      profile = await this.profileModel.findOne({ userKey: key }).lean().exec();
    }
    if (!profile) throw new NotFoundException('profile_not_found');
    await this.logAccess({
      action: 'profile_read',
      actorKey: this.actorKey(requester),
      targetUserKey: key,
    });
    return {
      user_id: key,
      top_categories: profile.topCategories ?? [],
      interest_scores: profile.interestScores ?? {},
      engagement_rate: Number(profile.engagementRate ?? 0),
      last_active: profile.lastActive
        ? new Date(profile.lastActive).toISOString()
        : null,
      segment: profile.segment ?? 'new_user',
      conversion_probability: Number(profile.conversionProbability ?? 0),
    };
  }

  private async readDailyCap(
    userKey: string,
    campaignId: string,
  ): Promise<number> {
    const dateKey = new Date().toISOString().slice(0, 10);
    const key = `freq:${userKey}:${campaignId}:${dateKey}`;
    const v = await this.cache.get<number>(key);
    return Number(v ?? 0);
  }

  private async increaseDailyCap(
    userKey: string,
    campaignId: string,
  ): Promise<void> {
    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);
    const key = `freq:${userKey}:${campaignId}:${dateKey}`;
    const current = await this.readDailyCap(userKey, campaignId);
    const end = new Date(now);
    end.setUTCHours(23, 59, 59, 999);
    const ttl = Math.max(
      60,
      Math.floor((end.getTime() - now.getTime()) / 1000),
    );
    await this.cache.set(key, current + 1, ttl * 1000);
  }

  private async canShowInterstitial(
    userKey: string,
    sessionId: string,
  ): Promise<boolean> {
    if (!sessionId.trim()) return true;
    const key = `freq:interstitial:${userKey}:${sessionId}`;
    const used = await this.cache.get<number>(key);
    return Number(used ?? 0) < 1;
  }

  private async markInterstitialShown(
    userKey: string,
    sessionId: string,
  ): Promise<void> {
    if (!sessionId.trim()) return;
    const key = `freq:interstitial:${userKey}:${sessionId}`;
    await this.cache.set(key, 1, 24 * 3600 * 1000);
  }

  private interestMatchFromRules(
    interestScores: InterestScores,
    rules: Record<string, unknown>,
    topCategories: string[],
  ): { value: number; reason: string } {
    const minInterest = (rules.min_interest_score ?? {}) as Record<
      string,
      unknown
    >;
    const categoriesRuleRaw =
      (rules.target_categories as unknown[]) ??
      (rules.categories as unknown[]) ??
      [];
    const categoriesRule = categoriesRuleRaw
      .map((x) => String(x).trim().toLowerCase())
      .filter(Boolean);
    const minKeys = Object.keys(minInterest)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    if (minKeys.length > 0) {
      const matches = minKeys.map((category) => {
        const required = Number(minInterest[category] ?? 0);
        const actual = Number(interestScores[category] ?? 0);
        if (required <= 0) return 1;
        return Math.min(1, actual / required);
      });
      const avg = matches.reduce((s, v) => s + v, 0) / matches.length;
      return {
        value: Number(avg.toFixed(4)),
        reason: `interest:${minKeys[0]}`,
      };
    }
    if (categoriesRule.length > 0) {
      const overlap = categoriesRule.filter((category) =>
        topCategories.includes(category),
      );
      const value =
        overlap.length > 0 ? overlap.length / categoriesRule.length : 0;
      return {
        value: Number(value.toFixed(4)),
        reason: overlap.length > 0 ? `interest:${overlap[0]}` : 'interest:none',
      };
    }
    return { value: 0.3, reason: 'interest:baseline' };
  }

  private async campaignPlacementStats(
    userKey: string,
    placement: string,
    campaignIds: string[],
  ): Promise<Map<string, CampaignPlacementStats>> {
    const out = new Map<string, CampaignPlacementStats>();
    if (!campaignIds.length) return out;
    const placementKeys = expandPlacementKeys(placement);
    if (!placementKeys.length) return out;

    const rows = await this.eventModel
      .aggregate<{
        _id: { campaignId: string; eventType: string };
        n: number;
      }>([
        {
          $match: {
            userKey,
            campaignId: { $in: campaignIds },
            placement: { $in: placementKeys },
          },
        },
        {
          $group: {
            _id: { campaignId: '$campaignId', eventType: '$eventType' },
            n: { $sum: 1 },
          },
        },
      ])
      .exec();

    for (const row of rows) {
      const cid = String(row._id?.campaignId ?? '').trim();
      if (!cid) continue;
      const cur = out.get(cid) ?? {
        impressions: 0,
        clicks: 0,
        purchases: 0,
      };
      const t = String(row._id?.eventType ?? '');
      const n = Number(row.n ?? 0);
      if (t === AdsTargetingEventTypeEnum.AD_IMPRESSION) {
        cur.impressions += n;
      } else if (
        t === AdsTargetingEventTypeEnum.AD_CLICK ||
        t === AdsTargetingEventTypeEnum.ITEM_CLICK
      ) {
        cur.clicks += n;
      } else if (t === AdsTargetingEventTypeEnum.PURCHASE) {
        cur.purchases += n;
      }
      out.set(cid, cur);
    }
    return out;
  }

  private async latestSessionId(userKey: string): Promise<string> {
    const row = await this.eventModel
      .findOne({ userKey })
      .sort({ timestamp: -1 })
      .select('sessionId')
      .lean()
      .exec();
    return String(
      (row as { sessionId?: string } | null)?.sessionId ?? '',
    ).trim();
  }

  async recommend(
    requester: UserModel | null | undefined,
    query: {
      userId?: string;
      placement?: string;
      slot?: number;
      limit?: number;
      countryCode?: string;
      clientPlatform?: string;
    },
  ): Promise<{ ads: RecommendResult[] }> {
    const fallbackUserId = requester?._id ? String(requester._id) : '';
    const userKey = String(query.userId ?? '').trim() || fallbackUserId;
    if (!userKey) return { ads: [] };

    const clientRegion = await this.adsService.resolvePublicClientRegion(
      requester ?? undefined,
      query.countryCode,
      query.clientPlatform,
    );

    await this.rebuildProfile(userKey);
    const profile = await this.profileModel.findOne({ userKey }).lean().exec();
    if (!profile) return { ads: [] };

    const now = new Date();
    const basePlacement = String(query.placement ?? 'home_feed')
      .trim()
      .toLowerCase();
    const requestSlot =
      query.slot != null && Number.isFinite(Number(query.slot))
        ? Math.max(0, Math.min(20, Math.floor(Number(query.slot))))
        : null;
    const placement =
      requestSlot != null && !basePlacement.includes(':slot_')
        ? buildPlacementWithSlot(basePlacement, requestSlot)
        : basePlacement;
    const limit = Math.max(1, Math.min(10, Number(query.limit ?? 3)));
    const campaigns = await this.campaignModel
      .find({
        isActive: true,
        startsAt: { $lte: now },
        endsAt: { $gte: now },
        archivedAt: { $exists: false },
      })
      .populate('store', 'name status region')
      .populate('items.product', 'title profileImage')
      .populate('items.drink', 'name imageUrl')
      .lean()
      .exec();

    const out: Array<
      RecommendResult & { campaignId: string; score: number; editorialPriority: number }
    > = [];
    const lastActive = profile.lastActive ? new Date(profile.lastActive) : null;
    const daysSinceActive = lastActive
      ? Math.max(0, (Date.now() - lastActive.getTime()) / 86_400_000)
      : 30;
    const recencyBoost = Math.max(
      0,
      Number((1 - daysSinceActive / 14).toFixed(4)),
    );
    const engagementScore = Number(profile.engagementRate ?? 0);
    const conversionProbability = Number(profile.conversionProbability ?? 0);
    const interestScores = (profile.interestScores ?? {}) as InterestScores;
    const topCategories = (profile.topCategories ?? []) as string[];
    const latestSession = await this.latestSessionId(userKey);
    const campaignIds = (campaigns as Array<Record<string, unknown>>)
      .map((c) => String(c._id ?? '').trim())
      .filter(Boolean);
    const storeIds = [
      ...new Set(
        (campaigns as Array<Record<string, unknown>>)
          .map((c) => {
            const storeRaw = c.store;
            if (storeRaw && typeof storeRaw === 'object' && '_id' in storeRaw) {
              return String((storeRaw as { _id?: unknown })._id ?? '').trim();
            }
            return String(storeRaw ?? '').trim();
          })
          .filter(Boolean),
      ),
    ];
    const regionByStoreId = await this.adsService.resolveStoreRegionMap(storeIds);
    const [planScoreByStore, recoWeights] = await Promise.all([
      storeIds.length
        ? this.subscriptionsService.resolveActivePlanScoreByStoreIds(storeIds)
        : Promise.resolve(new Map<string, number>()),
      this.searchSettingsService.getRecommendationWeights(),
    ]);
    const planScoreWeight = recoWeights.vendorPlanScore;
    const placementStats = await this.campaignPlacementStats(
      userKey,
      placement,
      campaignIds,
    );
    const profileSegment = String(profile.segment ?? '');

    for (const campaign of campaigns as Array<Record<string, unknown>>) {
      const campaignId = String(campaign._id ?? '').trim();
      if (!campaignId) continue;
      const storeRaw = campaign.store;
      let storeId = '';
      if (storeRaw && typeof storeRaw === 'object' && '_id' in storeRaw) {
        storeId = String((storeRaw as { _id?: unknown })._id ?? '').trim();
      } else if (storeRaw) {
        storeId = String(storeRaw).trim();
      }
      const storeRegion = storeId ? regionByStoreId.get(storeId) : undefined;
      if (!storeRegion || !this.adsService.matchesPublicClientRegion(clientRegion, storeRegion)) {
        continue;
      }
      const rules = (campaign.targetingRules ?? {}) as Record<string, unknown>;
      if (!matchesPlacementRules(rules, placement)) {
        continue;
      }
      const segments = Array.isArray(rules.segments)
        ? rules.segments.map((x) => String(x))
        : [];
      if (
        segments.length > 0 &&
        !segments.includes(String(profile.segment ?? ''))
      ) {
        continue;
      }
      const countries = Array.isArray(rules.countries)
        ? rules.countries.map((x) => String(x).trim().toUpperCase())
        : [];
      if (countries.length > 0) {
        const profileCountry = String(profile.country ?? '')
          .trim()
          .toUpperCase();
        if (!profileCountry || !countries.includes(profileCountry)) continue;
      }
      if (rules.exclude_converted === true) {
        const converted = await this.eventModel.exists({
          userKey,
          eventType: AdsTargetingEventTypeEnum.PURCHASE,
          campaignId,
        });
        if (converted) continue;
      }
      const dailyCap = await this.readDailyCap(userKey, campaignId);
      if (dailyCap >= 3) continue;
      const formats = Array.isArray(rules.formats)
        ? rules.formats.map((x) => String(x).toLowerCase())
        : [];
      const isInterstitial =
        formats.includes('interstitial') || placement.includes('interstitial');
      if (isInterstitial) {
        const canShow = await this.canShowInterstitial(userKey, latestSession);
        if (!canShow) continue;
      }

      const interest = this.interestMatchFromRules(
        interestScores,
        rules,
        topCategories,
      );
      const items = Array.isArray(campaign.items)
        ? (campaign.items as Record<string, unknown>[])
        : [];
      const hasProductItems = items.some(
        (it) =>
          String(it.itemType ?? '')
            .trim()
            .toUpperCase() === 'PRODUCT',
      );
      const actionType = String(campaign.actionType ?? 'SHOP');
      const priority = readEditorialPriority(rules);
      const preferredSlot = readPreferredSlot(rules);
      const slotForScoring =
        requestSlot ?? preferredSlot;
      const stats = placementStats.get(campaignId);
      const planScore = storeId ? (planScoreByStore.get(storeId) ?? 0) : 0;
      const vendorPlanBoost =
        planScoreWeight > 0
          ? (Math.max(0, planScore) / 100) * (planScoreWeight / 100)
          : 0;

      const score = computeAdsTargetingScore({
        interestMatch: interest.value,
        recencyBoost,
        engagementScore,
        conversionProbability,
        placementMatch: placementMatchScore(rules, placement),
        positionBoost: computePositionBoost({
          priority,
          preferredSlot,
          requestSlot: slotForScoring,
        }),
        deliveryConversionBoost: computeDeliveryConversionBoost({
          actionType,
          hasProductItems,
          segment: profileSegment,
          conversionProbability,
          requestSlot: slotForScoring,
        }),
        placementPerformance: computePlacementPerformanceBoost(stats),
        vendorPlanBoost,
      });
      if (score <= 0) continue;

      const first = items[0];
      let creativeUrl = '';
      let adId = `camp:${campaignId}`;
      if (first) {
        const itemType = String(first.itemType ?? '')
          .trim()
          .toUpperCase();
        if (itemType === 'PRODUCT') {
          const p = first.product as Record<string, unknown> | undefined;
          const pid = p?._id ? String(p._id) : '';
          if (pid) adId = `product:${pid}`;
          creativeUrl = String(p?.profileImage ?? '');
        } else if (itemType === 'DRINK') {
          const d = first.drink as Record<string, unknown> | undefined;
          const did = d?._id ? String(d._id) : '';
          if (did) adId = `drink:${did}`;
          creativeUrl = String(d?.imageUrl ?? '');
        }
      }
      out.push({
        ad_id: adId,
        campaign_id: campaignId,
        creative_url: creativeUrl,
        cta: String(campaign.actionText ?? 'Découvrir'),
        relevance_score: score,
        targeting_reason: [
          interest.reason,
          `placement:${placement}`,
          `position:p${priority}`,
        ].join('|'),
        campaignId,
        score,
        editorialPriority: priority,
      });
    }

    out.sort((a, b) => {
      const byScore = b.score - a.score;
      if (byScore !== 0) return byScore;
      if (a.editorialPriority !== b.editorialPriority) {
        return a.editorialPriority - b.editorialPriority;
      }
      return a.campaignId.localeCompare(b.campaignId);
    });
    const selected = out.slice(0, limit);
    for (const row of selected) {
      await this.increaseDailyCap(userKey, row.campaignId);
      if (placement.includes('interstitial')) {
        await this.markInterstitialShown(userKey, latestSession);
      }
    }
    await this.logAccess({
      action: 'recommend_read',
      actorKey: this.actorKey(requester),
      targetUserKey: userKey,
      metadata: {
        placement,
        slot: requestSlot,
        limit,
        returned: selected.length,
      },
    });
    return {
      ads: selected.map((row) => ({
        ad_id: row.ad_id,
        campaign_id: row.campaign_id,
        creative_url: row.creative_url,
        cta: row.cta,
        relevance_score: row.relevance_score,
        targeting_reason: row.targeting_reason,
      })),
    };
  }

  async createCampaign(
    requester: UserModel,
    dto: CreateAdCampaignDto,
  ): Promise<Record<string, unknown>> {
    const created = await this.adsService.createCampaign(requester, dto);
    const targetingRules = dto.targetingRules ?? {};
    await this.campaignModel
      .updateOne(
        { _id: created.id },
        { $set: { targetingRules, archivedAt: null } },
      )
      .exec();
    await this.logAccess({
      action: 'campaign_create',
      actorKey: this.actorKey(requester),
      targetCampaignId: created.id,
    });
    return this.getCampaignByIdForManage(created.id);
  }

  private async getCampaignByIdForManage(
    id: string,
  ): Promise<Record<string, unknown>> {
    const row = await this.campaignModel
      .findById(id)
      .populate('store', 'name profileImage')
      .populate('items.product', 'title profileImage price')
      .populate('items.drink', 'name imageUrl priceCad')
      .lean()
      .exec();
    if (!row) throw new NotFoundException('campaign_not_found');
    const store = (row.store ?? {}) as Record<string, unknown>;
    const items = Array.isArray(row.items)
      ? (row.items as Record<string, unknown>[])
      : [];
    return {
      id: String(row._id),
      storeId: String(store._id ?? ''),
      storeName: String(store.name ?? ''),
      storeProfileImageUrl: String(store.profileImage ?? ''),
      title: String(row.title ?? ''),
      subtitle: String(row.subtitle ?? ''),
      description: String(row.description ?? ''),
      startsAt: row.startsAt
        ? new Date(row.startsAt as Date).toISOString()
        : null,
      endsAt: row.endsAt ? new Date(row.endsAt as Date).toISOString() : null,
      isActive: Boolean(row.isActive),
      actionType: String(row.actionType ?? 'SHOP'),
      actionText: String(row.actionText ?? 'Découvrir'),
      actionTarget: row.actionTarget ? String(row.actionTarget) : null,
      targetingRules: (row.targetingRules ?? {}) as Record<string, unknown>,
      archivedAt: row.archivedAt
        ? new Date(row.archivedAt as Date).toISOString()
        : null,
      items: items.map((item) => {
        const itemType = String(item.itemType ?? '').toUpperCase();
        if (itemType === 'PRODUCT') {
          const product = (item.product ?? {}) as Record<string, unknown>;
          return {
            itemType,
            productId: product._id ? String(product._id) : null,
            drinkId: null,
            title: String(product.title ?? '(produit supprimé)'),
            imageUrl: product.profileImage
              ? String(product.profileImage)
              : null,
            priceCad: Number(product.price ?? 0),
          };
        }
        const drink = (item.drink ?? {}) as Record<string, unknown>;
        return {
          itemType: 'DRINK',
          productId: null,
          drinkId: drink._id ? String(drink._id) : null,
          title: String(drink.name ?? '(boisson supprimée)'),
          imageUrl: drink.imageUrl ? String(drink.imageUrl) : null,
          priceCad: Number(drink.priceCad ?? 0),
        };
      }),
    };
  }

  async listCampaigns(
    requester: UserModel,
  ): Promise<Record<string, unknown>[]> {
    const rows = await this.adsService.listCampaignsForManagement(requester);
    const byId = new Map(rows.map((row) => [row.id, row]));
    const targetingRows = await this.campaignModel
      .find({ _id: { $in: [...byId.keys()] } })
      .select('_id targetingRules archivedAt')
      .lean()
      .exec();
    const metaById = new Map(
      targetingRows.map((row) => [
        String(row._id),
        row as Record<string, unknown>,
      ]),
    );
    return rows.map((row) => {
      const meta = metaById.get(row.id);
      return {
        ...row,
        targetingRules: (meta?.targetingRules ?? {}) as Record<string, unknown>,
        archivedAt:
          meta?.archivedAt != null
            ? new Date(meta.archivedAt as Date).toISOString()
            : null,
      };
    });
  }

  async patchCampaign(
    requester: UserModel,
    id: string,
    dto: PatchAdCampaignDto,
  ): Promise<Record<string, unknown>> {
    const patchPayload = { ...dto };
    delete (patchPayload as Record<string, unknown>).targetingRules;
    const hasPatchPayload = Object.keys(patchPayload).length > 0;
    if (hasPatchPayload) {
      await this.adsService.patchCampaign(requester, id, patchPayload);
    } else {
      const existing = await this.campaignModel
        .findById(id)
        .select('_id')
        .lean()
        .exec();
      if (!existing) throw new NotFoundException('campaign_not_found');
    }
    if (dto.targetingRules !== undefined) {
      await this.campaignModel
        .updateOne(
          { _id: id },
          {
            $set: {
              targetingRules: dto.targetingRules ?? {},
            },
          },
        )
        .exec();
    }
    await this.logAccess({
      action: 'campaign_patch',
      actorKey: this.actorKey(requester),
      targetCampaignId: id,
    });
    return this.getCampaignByIdForManage(id);
  }

  async archiveCampaign(
    requester: UserModel,
    id: string,
  ): Promise<{ ok: true }> {
    await this.adsService.patchCampaign(requester, id, { isActive: false });
    await this.campaignModel
      .updateOne({ _id: id }, { $set: { archivedAt: new Date() } })
      .exec();
    await this.logAccess({
      action: 'campaign_archive',
      actorKey: this.actorKey(requester),
      targetCampaignId: id,
    });
    return { ok: true };
  }

  async campaignStats(
    requester: UserModel,
    id: string,
  ): Promise<Record<string, unknown>> {
    const stats = (await this.adsService.getCampaignStats(
      requester,
      id,
    )) as unknown as Record<string, unknown>;
    await this.logAccess({
      action: 'campaign_stats_read',
      actorKey: this.actorKey(requester),
      targetCampaignId: id,
    });
    return stats;
  }

  async eraseUserData(
    requester: UserModel | null | undefined,
    userKey: string,
  ): Promise<{ ok: true; deletedEvents: number }> {
    const key = userKey.trim();
    this.ensureCanEraseUserData(requester, key);
    const del = await this.eventModel.deleteMany({ userKey: key }).exec();
    await this.profileModel.deleteOne({ userKey: key }).exec();
    await this.logAccess({
      action: 'gdpr_erase_user_data',
      actorKey: this.actorKey(requester),
      targetUserKey: key,
      metadata: { deletedEvents: del.deletedCount ?? 0 },
    });
    return { ok: true, deletedEvents: del.deletedCount ?? 0 };
  }

  async dashboardOverview(
    requester: UserModel,
  ): Promise<Record<string, unknown>> {
    this.ensureAdmin(requester);
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const [activeCampaigns, impressionsToday, clicksToday, topSegments] =
      await Promise.all([
        this.campaignModel.countDocuments({
          isActive: true,
          startsAt: { $lte: new Date() },
          endsAt: { $gte: new Date() },
          archivedAt: { $exists: false },
        }),
        this.eventModel.countDocuments({
          timestamp: { $gte: start },
          eventType: AdsTargetingEventTypeEnum.AD_IMPRESSION,
        }),
        this.eventModel.countDocuments({
          timestamp: { $gte: start },
          eventType: AdsTargetingEventTypeEnum.AD_CLICK,
        }),
        this.profileModel
          .aggregate<{ _id: string; count: number }>([
            { $group: { _id: '$segment', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
            { $limit: 8 },
          ])
          .exec(),
      ]);
    const ctr =
      impressionsToday > 0 ? (clicksToday / impressionsToday) * 100 : 0;
    await this.logAccess({
      action: 'dashboard_overview_read',
      actorKey: this.actorKey(requester),
    });
    return {
      date: start.toISOString().slice(0, 10),
      activeCampaigns,
      impressionsToday,
      clicksToday,
      ctrToday: Number(ctr.toFixed(2)),
      topSegments: topSegments.map((row) => ({
        segment: String(row._id ?? ''),
        count: Number(row.count ?? 0),
      })),
    };
  }

  @Cron(process.env.ADS_TARGETING_RETENTION_CRON ?? '0 2 * * *')
  async purgeOldData(): Promise<void> {
    await this.cronMonitor.execute('ads_targeting_retention', async () => {
      const retention = this.retentionDays();
      const cutoff = new Date(Date.now() - retention * 86_400_000);
      const [eventsRes, logsRes] = await Promise.all([
        this.eventModel.deleteMany({ timestamp: { $lt: cutoff } }).exec(),
        this.auditLogModel.deleteMany({ createdAt: { $lt: cutoff } }).exec(),
      ]);
      this.logger.log(
        `ads targeting retention purge done: events=${
          eventsRes.deletedCount ?? 0
        }, logs=${logsRes.deletedCount ?? 0}, days=${retention}`,
      );
    });
  }
}
