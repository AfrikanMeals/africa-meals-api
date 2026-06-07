import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { AdEventModel, AdEventTypeEnum } from '@schemas/ad-event.schema';
import {
  AdCampaignEventModel,
  AdCampaignEventTypeEnum,
} from '@schemas/ad-campaign-event.schema';
import { AdCampaignModel } from '@schemas/ad-campaign.schema';
import { AdModel } from '@schemas/ad.schema';
import { AdNotificationEventModel } from '@schemas/ad-notification-event.schema';
import {
  AdCreditPaymentModel,
  AdCreditPaymentStatusEnum,
} from '@schemas/ad-credit-payment.schema';
import { StoreModel } from '@schemas/store.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model, Types } from 'mongoose';

export type AdManagerRangeQuery = {
  from?: string;
  to?: string;
};

export type AdManagerOverview = {
  range: { from: string; to: string };
  currency: string;
  impressions: number;
  clicks: number;
  conversions: number;
  ctrPercent: number;
  conversionRatePercent: number;
  activeBanners: number;
  activeCampaigns: number;
  archivedBanners: number;
  archivedCampaigns: number;
  spendCad: number;
  revenueCad: number;
  grossDueCad: number;
  paidTotalCad: number;
  outstandingCad: number;
  notifications: {
    deliveries: number;
    interactions: number;
    conversions: number;
  };
};

export type AdManagerTimeseriesPoint = {
  date: string;
  impressions: number;
  clicks: number;
  conversions: number;
};

export type AdManagerEntityRow = {
  id: string;
  kind: 'BANNER' | 'CAMPAIGN';
  title: string;
  storeId: string | null;
  storeName: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  isActive: boolean;
  impressions: number;
  clicks: number;
  conversions: number;
  ctrPercent: number;
  conversionRatePercent: number;
  spendCad: number;
  createdAt: string | null;
  archivedAt: string | null;
};

export type AdManagerVendorRow = {
  ownerId: string;
  vendorName: string;
  vendorEmail: string | null;
  storeCount: number;
  impressions: number;
  clicks: number;
  conversions: number;
  spendCad: number;
  grossDueCad: number;
  paidCad: number;
  outstandingCad: number;
};

export type AdManagerNotificationStats = {
  range: { from: string; to: string };
  totals: { deliveries: number; interactions: number; conversions: number };
  interactionRatePercent: number;
  conversionRatePercent: number;
  byChannel: Array<{
    channel: string;
    deliveries: number;
    interactions: number;
    conversions: number;
  }>;
  last7Days: Array<{
    date: string;
    deliveries: number;
    interactions: number;
    conversions: number;
  }>;
};

export type AdManagerLiveEventRow = {
  at: string;
  scope: 'BANNER' | 'CAMPAIGN';
  eventType: string;
  entityId: string;
};

type Counts = { impressions: number; clicks: number; conversions: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_DAYS = 30;
const CURRENCY = 'CAD';

function round2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function percent(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return round2((numerator / denominator) * 100);
}

function startOfUtcDay(date: Date): Date {
  const d = new Date(date.getTime());
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function dateKey(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10);
}

@Injectable()
export class AdsAdminService {
  @InjectModel(AdModel.name)
  private readonly adModel: Model<AdModel>;

  @InjectModel(AdEventModel.name)
  private readonly adEventModel: Model<AdEventModel>;

  @InjectModel(AdCampaignModel.name)
  private readonly campaignModel: Model<AdCampaignModel>;

  @InjectModel(AdCampaignEventModel.name)
  private readonly campaignEventModel: Model<AdCampaignEventModel>;

  @InjectModel(AdNotificationEventModel.name)
  private readonly notificationEventModel: Model<AdNotificationEventModel>;

  @InjectModel(AdCreditPaymentModel.name)
  private readonly paymentModel: Model<AdCreditPaymentModel>;

  @InjectModel(StoreModel.name)
  private readonly storeModel: Model<StoreModel>;

  @InjectModel(UserModel.name)
  private readonly userModel: Model<UserModel>;

  private assertAdmin(user: UserModel): void {
    if (user?.type !== UserTypeEnum.ADMIN) {
      throw new ForbiddenException('admin_only');
    }
  }

  /** Borne la période : `start` inclusif (00:00 UTC), `endExclusive` exclusif. */
  private resolveRange(query: AdManagerRangeQuery): {
    start: Date;
    endExclusive: Date;
  } {
    const now = new Date();
    const parsedTo = query.to ? new Date(query.to) : null;
    const toBase =
      parsedTo && !Number.isNaN(parsedTo.getTime()) ? parsedTo : now;
    // Fin de journée incluse -> exclusif au début du jour suivant.
    const endExclusive = new Date(startOfUtcDay(toBase).getTime() + DAY_MS);

    const parsedFrom = query.from ? new Date(query.from) : null;
    const start =
      parsedFrom && !Number.isNaN(parsedFrom.getTime())
        ? startOfUtcDay(parsedFrom)
        : startOfUtcDay(
            new Date(endExclusive.getTime() - DEFAULT_RANGE_DAYS * DAY_MS),
          );

    if (start.getTime() >= endExclusive.getTime()) {
      return {
        start: new Date(endExclusive.getTime() - DAY_MS),
        endExclusive,
      };
    }
    return { start, endExclusive };
  }

  private async countEventsByType(
    model: Model<AdEventModel> | Model<AdCampaignEventModel>,
    range?: { start: Date; endExclusive: Date },
  ): Promise<Counts> {
    const match: Record<string, unknown> = {};
    if (range) {
      match.createdAt = { $gte: range.start, $lt: range.endExclusive };
    }
    const rows = await (model as Model<AdEventModel>)
      .aggregate<{ _id: string; count: number }>([
        { $match: match },
        { $group: { _id: '$eventType', count: { $sum: 1 } } },
      ])
      .exec();
    const out: Counts = { impressions: 0, clicks: 0, conversions: 0 };
    for (const row of rows) {
      if (row._id === AdEventTypeEnum.IMPRESSION) out.impressions = row.count;
      else if (row._id === AdEventTypeEnum.CLICK) out.clicks = row.count;
      else if (row._id === AdEventTypeEnum.CONVERSION)
        out.conversions = row.count;
    }
    return out;
  }

  private async sumBilling(
    model: Model<AdModel> | Model<AdCampaignModel>,
    range?: { start: Date; endExclusive: Date },
  ): Promise<number> {
    const match: Record<string, unknown> = {
      billingFinalizedAt: { $ne: null },
    };
    if (range) {
      match.billingFinalizedAt = {
        $gte: range.start,
        $lt: range.endExclusive,
      };
    }
    const rows = await (model as Model<AdModel>)
      .aggregate<{ _id: null; total: number }>([
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ['$billingFinalAmountCad', 0] } },
          },
        },
      ])
      .exec();
    return round2(rows[0]?.total ?? 0);
  }

  private async sumPaid(range?: {
    start: Date;
    endExclusive: Date;
  }): Promise<number> {
    const match: Record<string, unknown> = {
      status: AdCreditPaymentStatusEnum.PAID,
    };
    if (range) {
      match.paidAt = { $gte: range.start, $lt: range.endExclusive };
    }
    const rows = await this.paymentModel
      .aggregate<{ _id: null; total: number }>([
        { $match: match },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ['$amountPaidCad', 0] } },
          },
        },
      ])
      .exec();
    return round2(rows[0]?.total ?? 0);
  }

  async getOverview(
    user: UserModel,
    query: AdManagerRangeQuery,
  ): Promise<AdManagerOverview> {
    this.assertAdmin(user);
    const range = this.resolveRange(query);
    const activeFilter = {
      $or: [{ archivedAt: { $exists: false } }, { archivedAt: null }],
    };

    const [
      bannerCounts,
      campaignCounts,
      activeBanners,
      activeCampaigns,
      archivedBanners,
      archivedCampaigns,
      bannerSpend,
      campaignSpend,
      bannerGross,
      campaignGross,
      revenueCad,
      paidTotalCad,
      deliveries,
      interactions,
      notifConversions,
    ] = await Promise.all([
      this.countEventsByType(this.adEventModel, range),
      this.countEventsByType(this.campaignEventModel, range),
      this.adModel.countDocuments({ ...activeFilter, isActive: true }).exec(),
      this.campaignModel
        .countDocuments({ ...activeFilter, isActive: true })
        .exec(),
      this.adModel.countDocuments({ archivedAt: { $ne: null } }).exec(),
      this.campaignModel.countDocuments({ archivedAt: { $ne: null } }).exec(),
      this.sumBilling(this.adModel, range),
      this.sumBilling(this.campaignModel, range),
      this.sumBilling(this.adModel),
      this.sumBilling(this.campaignModel),
      this.sumPaid(range),
      this.sumPaid(),
      this.notificationEventModel
        .countDocuments({
          deliveredAt: { $gte: range.start, $lt: range.endExclusive },
        })
        .exec(),
      this.notificationEventModel
        .countDocuments({
          interactionAt: { $gte: range.start, $lt: range.endExclusive },
        })
        .exec(),
      this.notificationEventModel
        .countDocuments({
          conversionAt: { $gte: range.start, $lt: range.endExclusive },
        })
        .exec(),
    ]);

    const impressions = bannerCounts.impressions + campaignCounts.impressions;
    const clicks = bannerCounts.clicks + campaignCounts.clicks;
    const conversions = bannerCounts.conversions + campaignCounts.conversions;
    const grossDueCad = round2(bannerGross + campaignGross);

    return {
      range: {
        from: range.start.toISOString(),
        to: new Date(range.endExclusive.getTime() - DAY_MS).toISOString(),
      },
      currency: CURRENCY,
      impressions,
      clicks,
      conversions,
      ctrPercent: percent(clicks, impressions),
      conversionRatePercent: percent(conversions, clicks),
      activeBanners,
      activeCampaigns,
      archivedBanners,
      archivedCampaigns,
      spendCad: round2(bannerSpend + campaignSpend),
      revenueCad,
      grossDueCad,
      paidTotalCad,
      outstandingCad: round2(Math.max(grossDueCad - paidTotalCad, 0)),
      notifications: {
        deliveries,
        interactions,
        conversions: notifConversions,
      },
    };
  }

  private async bucketByDay(
    model: Model<AdEventModel> | Model<AdCampaignEventModel>,
    range: { start: Date; endExclusive: Date },
  ): Promise<Map<string, Counts>> {
    const rows = await (model as Model<AdEventModel>)
      .aggregate<{
        _id: string;
        impressions: number;
        clicks: number;
        conversions: number;
      }>([
        {
          $match: {
            createdAt: { $gte: range.start, $lt: range.endExclusive },
          },
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$createdAt',
                timezone: 'UTC',
              },
            },
            impressions: {
              $sum: {
                $cond: [{ $eq: ['$eventType', AdEventTypeEnum.IMPRESSION] }, 1, 0],
              },
            },
            clicks: {
              $sum: {
                $cond: [{ $eq: ['$eventType', AdEventTypeEnum.CLICK] }, 1, 0],
              },
            },
            conversions: {
              $sum: {
                $cond: [
                  { $eq: ['$eventType', AdEventTypeEnum.CONVERSION] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ])
      .exec();
    const map = new Map<string, Counts>();
    for (const row of rows) {
      map.set(row._id, {
        impressions: row.impressions,
        clicks: row.clicks,
        conversions: row.conversions,
      });
    }
    return map;
  }

  async getTimeseries(
    user: UserModel,
    query: AdManagerRangeQuery,
  ): Promise<AdManagerTimeseriesPoint[]> {
    this.assertAdmin(user);
    const range = this.resolveRange(query);
    const [bannerByDay, campaignByDay] = await Promise.all([
      this.bucketByDay(this.adEventModel, range),
      this.bucketByDay(this.campaignEventModel, range),
    ]);

    const points: AdManagerTimeseriesPoint[] = [];
    for (
      let cursor = startOfUtcDay(range.start).getTime();
      cursor < range.endExclusive.getTime();
      cursor += DAY_MS
    ) {
      const key = dateKey(new Date(cursor));
      const b = bannerByDay.get(key);
      const c = campaignByDay.get(key);
      points.push({
        date: key,
        impressions: (b?.impressions ?? 0) + (c?.impressions ?? 0),
        clicks: (b?.clicks ?? 0) + (c?.clicks ?? 0),
        conversions: (b?.conversions ?? 0) + (c?.conversions ?? 0),
      });
    }
    return points;
  }

  /** Comptage d'événements groupé par entité (bannière ou campagne). */
  private async eventCountsByEntity(
    model: Model<AdEventModel> | Model<AdCampaignEventModel>,
    entityField: 'ad' | 'campaign',
  ): Promise<Map<string, Counts>> {
    const rows = await (model as Model<AdEventModel>)
      .aggregate<{
        _id: Types.ObjectId;
        impressions: number;
        clicks: number;
        conversions: number;
      }>([
        {
          $group: {
            _id: `$${entityField}`,
            impressions: {
              $sum: {
                $cond: [{ $eq: ['$eventType', AdEventTypeEnum.IMPRESSION] }, 1, 0],
              },
            },
            clicks: {
              $sum: {
                $cond: [{ $eq: ['$eventType', AdEventTypeEnum.CLICK] }, 1, 0],
              },
            },
            conversions: {
              $sum: {
                $cond: [
                  { $eq: ['$eventType', AdEventTypeEnum.CONVERSION] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ])
      .exec();
    const map = new Map<string, Counts>();
    for (const row of rows) {
      if (!row._id) continue;
      map.set(String(row._id), {
        impressions: row.impressions,
        clicks: row.clicks,
        conversions: row.conversions,
      });
    }
    return map;
  }

  async getEntities(
    user: UserModel,
    opts: {
      kind?: 'BANNER' | 'CAMPAIGN' | 'ALL';
      status?: 'ACTIVE' | 'ARCHIVED' | 'ALL';
      sort?: 'spend' | 'impressions' | 'clicks' | 'conversions';
      limit?: number;
    },
  ): Promise<AdManagerEntityRow[]> {
    this.assertAdmin(user);
    const kind = opts.kind ?? 'ALL';
    const status = opts.status ?? 'ALL';
    const sort = opts.sort ?? 'spend';
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);

    const includeBanners = kind === 'ALL' || kind === 'BANNER';
    const includeCampaigns = kind === 'ALL' || kind === 'CAMPAIGN';

    const [bannerDocs, campaignDocs, bannerCounts, campaignCounts] =
      await Promise.all([
        includeBanners
          ? this.adModel
              .find()
              .select(
                '_id title store isActive archivedAt billingFinalAmountCad createdAt',
              )
              .populate('store', 'name')
              .lean()
              .exec()
          : Promise.resolve([]),
        includeCampaigns
          ? this.campaignModel
              .find()
              .select(
                '_id title store isActive archivedAt billingFinalAmountCad createdAt',
              )
              .populate('store', 'name')
              .lean()
              .exec()
          : Promise.resolve([]),
        includeBanners
          ? this.eventCountsByEntity(this.adEventModel, 'ad')
          : Promise.resolve(new Map<string, Counts>()),
        includeCampaigns
          ? this.eventCountsByEntity(this.campaignEventModel, 'campaign')
          : Promise.resolve(new Map<string, Counts>()),
      ]);

    const toRow = (
      doc: Record<string, unknown>,
      entityKind: 'BANNER' | 'CAMPAIGN',
      counts: Map<string, Counts>,
    ): AdManagerEntityRow => {
      const id = String(doc._id ?? '');
      const c = counts.get(id) ?? {
        impressions: 0,
        clicks: 0,
        conversions: 0,
      };
      const storeRef = doc.store as { _id?: unknown; name?: string } | null;
      const archivedAt = doc.archivedAt as Date | string | null | undefined;
      const createdAt = doc.createdAt as Date | string | null | undefined;
      const isActive = Boolean(doc.isActive);
      const isArchived = archivedAt != null && String(archivedAt).trim() !== '';
      return {
        id,
        kind: entityKind,
        title: String(doc.title ?? '—'),
        storeId: storeRef?._id ? String(storeRef._id) : null,
        storeName: storeRef?.name ?? null,
        status: isArchived ? 'ARCHIVED' : 'ACTIVE',
        isActive,
        impressions: c.impressions,
        clicks: c.clicks,
        conversions: c.conversions,
        ctrPercent: percent(c.clicks, c.impressions),
        conversionRatePercent: percent(c.conversions, c.clicks),
        spendCad: round2(Number(doc.billingFinalAmountCad ?? 0)),
        createdAt:
          createdAt instanceof Date
            ? createdAt.toISOString()
            : createdAt
              ? String(createdAt)
              : null,
        archivedAt:
          archivedAt instanceof Date
            ? archivedAt.toISOString()
            : isArchived
              ? String(archivedAt)
              : null,
      };
    };

    let rows: AdManagerEntityRow[] = [
      ...(bannerDocs as Array<Record<string, unknown>>).map((d) =>
        toRow(d, 'BANNER', bannerCounts),
      ),
      ...(campaignDocs as Array<Record<string, unknown>>).map((d) =>
        toRow(d, 'CAMPAIGN', campaignCounts),
      ),
    ];

    if (status !== 'ALL') {
      rows = rows.filter((r) => r.status === status);
    }

    rows.sort((a, b) => {
      switch (sort) {
        case 'impressions':
          return b.impressions - a.impressions;
        case 'clicks':
          return b.clicks - a.clicks;
        case 'conversions':
          return b.conversions - a.conversions;
        case 'spend':
        default:
          return b.spendCad - a.spendCad;
      }
    });

    return rows.slice(0, limit);
  }

  async getVendors(
    user: UserModel,
    query: AdManagerRangeQuery,
  ): Promise<AdManagerVendorRow[]> {
    this.assertAdmin(user);
    const range = this.resolveRange(query);

    const stores = await this.storeModel
      .find()
      .select('_id name owner')
      .lean()
      .exec();

    const storeToOwner = new Map<string, string>();
    const ownerStoreCount = new Map<string, number>();
    const ownerIds = new Set<string>();
    for (const s of stores as Array<Record<string, unknown>>) {
      const sid = String(s._id ?? '');
      const ownerId = s.owner ? String(s.owner) : '';
      if (!sid || !ownerId) continue;
      storeToOwner.set(sid, ownerId);
      ownerStoreCount.set(ownerId, (ownerStoreCount.get(ownerId) ?? 0) + 1);
      ownerIds.add(ownerId);
    }

    const [bannerDocs, campaignDocs, bannerCounts, campaignCounts, payments] =
      await Promise.all([
        this.adModel
          .find({ store: { $ne: null } })
          .select('_id store billingFinalAmountCad billingFinalizedAt')
          .lean()
          .exec(),
        this.campaignModel
          .find()
          .select('_id store billingFinalAmountCad billingFinalizedAt')
          .lean()
          .exec(),
        this.eventCountsByEntity(this.adEventModel, 'ad'),
        this.eventCountsByEntity(this.campaignEventModel, 'campaign'),
        this.paymentModel
          .aggregate<{ _id: Types.ObjectId; total: number }>([
            { $match: { status: AdCreditPaymentStatusEnum.PAID } },
            {
              $group: {
                _id: '$owner',
                total: { $sum: { $ifNull: ['$amountPaidCad', 0] } },
              },
            },
          ])
          .exec(),
      ]);

    type Acc = {
      impressions: number;
      clicks: number;
      conversions: number;
      spendCad: number;
      grossDueCad: number;
    };
    const perOwner = new Map<string, Acc>();
    const ensure = (ownerId: string): Acc => {
      let acc = perOwner.get(ownerId);
      if (!acc) {
        acc = {
          impressions: 0,
          clicks: 0,
          conversions: 0,
          spendCad: 0,
          grossDueCad: 0,
        };
        perOwner.set(ownerId, acc);
      }
      return acc;
    };

    const accumulate = (
      docs: Array<Record<string, unknown>>,
      counts: Map<string, Counts>,
    ) => {
      for (const doc of docs) {
        const sid = String(doc.store ?? '');
        const ownerId = storeToOwner.get(sid);
        if (!ownerId) continue;
        const acc = ensure(ownerId);
        const c = counts.get(String(doc._id ?? '')) ?? {
          impressions: 0,
          clicks: 0,
          conversions: 0,
        };
        acc.impressions += c.impressions;
        acc.clicks += c.clicks;
        acc.conversions += c.conversions;
        const finalized = doc.billingFinalizedAt as Date | string | null | undefined;
        const amount = Number(doc.billingFinalAmountCad ?? 0);
        if (finalized != null && String(finalized).trim() !== '') {
          acc.grossDueCad += amount;
          const finalizedDate =
            finalized instanceof Date ? finalized : new Date(String(finalized));
          if (
            !Number.isNaN(finalizedDate.getTime()) &&
            finalizedDate >= range.start &&
            finalizedDate < range.endExclusive
          ) {
            acc.spendCad += amount;
          }
        }
      }
    };

    accumulate(bannerDocs as Array<Record<string, unknown>>, bannerCounts);
    accumulate(campaignDocs as Array<Record<string, unknown>>, campaignCounts);

    const paidByOwner = new Map<string, number>();
    for (const row of payments) {
      if (!row._id) continue;
      paidByOwner.set(String(row._id), round2(row.total));
    }

    const ownersToFetch = Array.from(
      new Set<string>([...perOwner.keys(), ...paidByOwner.keys()]),
    ).filter((id) => Types.ObjectId.isValid(id));

    const ownerDocs = ownersToFetch.length
      ? await this.userModel
          .find({ _id: { $in: ownersToFetch.map((id) => new Types.ObjectId(id)) } })
          .select('_id fullName email')
          .lean()
          .exec()
      : [];
    const ownerInfo = new Map<string, { name: string; email: string | null }>();
    for (const o of ownerDocs as Array<Record<string, unknown>>) {
      ownerInfo.set(String(o._id), {
        name: String(o.fullName ?? o.email ?? 'Vendeur'),
        email: (o.email as string | undefined) ?? null,
      });
    }

    const rows: AdManagerVendorRow[] = ownersToFetch.map((ownerId) => {
      const acc = perOwner.get(ownerId) ?? {
        impressions: 0,
        clicks: 0,
        conversions: 0,
        spendCad: 0,
        grossDueCad: 0,
      };
      const info = ownerInfo.get(ownerId) ?? { name: 'Vendeur', email: null };
      const grossDueCad = round2(acc.grossDueCad);
      const paidCad = paidByOwner.get(ownerId) ?? 0;
      return {
        ownerId,
        vendorName: info.name,
        vendorEmail: info.email,
        storeCount: ownerStoreCount.get(ownerId) ?? 0,
        impressions: acc.impressions,
        clicks: acc.clicks,
        conversions: acc.conversions,
        spendCad: round2(acc.spendCad),
        grossDueCad,
        paidCad,
        outstandingCad: round2(Math.max(grossDueCad - paidCad, 0)),
      };
    });

    rows.sort((a, b) => b.grossDueCad - a.grossDueCad);
    return rows;
  }

  async getNotifications(
    user: UserModel,
    query: AdManagerRangeQuery,
  ): Promise<AdManagerNotificationStats> {
    this.assertAdmin(user);
    const range = this.resolveRange(query);

    const since = new Date(
      startOfUtcDay(range.endExclusive).getTime() - 7 * DAY_MS,
    );

    const [byChannelRows, last7Rows, totalsRow] = await Promise.all([
      this.notificationEventModel
        .aggregate<{
          _id: string;
          deliveries: number;
          interactions: number;
          conversions: number;
        }>([
          {
            $match: {
              deliveredAt: { $gte: range.start, $lt: range.endExclusive },
            },
          },
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
        ])
        .exec(),
      this.notificationEventModel
        .aggregate<{
          _id: string;
          deliveries: number;
          interactions: number;
          conversions: number;
        }>([
          {
            $match: {
              deliveredAt: { $gte: since, $lt: range.endExclusive },
            },
          },
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
                $sum: { $cond: [{ $ifNull: ['$interactionAt', false] }, 1, 0] },
              },
              conversions: {
                $sum: { $cond: [{ $ifNull: ['$conversionAt', false] }, 1, 0] },
              },
            },
          },
        ])
        .exec(),
      this.notificationEventModel
        .aggregate<{
          _id: null;
          deliveries: number;
          interactions: number;
          conversions: number;
        }>([
          {
            $match: {
              deliveredAt: { $gte: range.start, $lt: range.endExclusive },
            },
          },
          {
            $group: {
              _id: null,
              deliveries: { $sum: 1 },
              interactions: {
                $sum: { $cond: [{ $ifNull: ['$interactionAt', false] }, 1, 0] },
              },
              conversions: {
                $sum: { $cond: [{ $ifNull: ['$conversionAt', false] }, 1, 0] },
              },
            },
          },
        ])
        .exec(),
    ]);

    const totals = {
      deliveries: totalsRow[0]?.deliveries ?? 0,
      interactions: totalsRow[0]?.interactions ?? 0,
      conversions: totalsRow[0]?.conversions ?? 0,
    };

    const last7Map = new Map<
      string,
      { deliveries: number; interactions: number; conversions: number }
    >();
    for (const row of last7Rows) {
      last7Map.set(row._id, {
        deliveries: row.deliveries,
        interactions: row.interactions,
        conversions: row.conversions,
      });
    }
    const last7Days: AdManagerNotificationStats['last7Days'] = [];
    for (
      let cursor = since.getTime();
      cursor < range.endExclusive.getTime();
      cursor += DAY_MS
    ) {
      const key = dateKey(new Date(cursor));
      const v = last7Map.get(key);
      last7Days.push({
        date: key,
        deliveries: v?.deliveries ?? 0,
        interactions: v?.interactions ?? 0,
        conversions: v?.conversions ?? 0,
      });
    }

    return {
      range: {
        from: range.start.toISOString(),
        to: new Date(range.endExclusive.getTime() - DAY_MS).toISOString(),
      },
      totals,
      interactionRatePercent: percent(totals.interactions, totals.deliveries),
      conversionRatePercent: percent(totals.conversions, totals.deliveries),
      byChannel: byChannelRows.map((row) => ({
        channel: row._id,
        deliveries: row.deliveries,
        interactions: row.interactions,
        conversions: row.conversions,
      })),
      last7Days,
    };
  }

  /** Derniers événements bannières + campagnes sur la période (flux Ad Manager). */
  async getRecentEvents(
    user: UserModel,
    query: AdManagerRangeQuery & { limit?: number },
  ): Promise<AdManagerLiveEventRow[]> {
    this.assertAdmin(user);
    const range = this.resolveRange(query);
    const limit = Math.min(Math.max(Number(query.limit) || 60, 1), 200);
    const match = {
      createdAt: { $gte: range.start, $lt: range.endExclusive },
    };
    const [bannerDocs, campaignDocs] = await Promise.all([
      this.adEventModel
        .find(match)
        .sort({ createdAt: -1 })
        .limit(limit)
        .select('ad eventType createdAt')
        .lean()
        .exec(),
      this.campaignEventModel
        .find(match)
        .sort({ createdAt: -1 })
        .limit(limit)
        .select('campaign eventType createdAt')
        .lean()
        .exec(),
    ]);
    const rows: AdManagerLiveEventRow[] = [
      ...(bannerDocs as Array<Record<string, unknown>>).map((doc) => ({
        at: new Date(String(doc.createdAt ?? '')).toISOString(),
        scope: 'BANNER' as const,
        eventType: String(doc.eventType ?? ''),
        entityId: String(doc.ad ?? ''),
      })),
      ...(campaignDocs as Array<Record<string, unknown>>).map((doc) => ({
        at: new Date(String(doc.createdAt ?? '')).toISOString(),
        scope: 'CAMPAIGN' as const,
        eventType: String(doc.eventType ?? ''),
        entityId: String(doc.campaign ?? ''),
      })),
    ]
      .filter((row) => row.entityId && !Number.isNaN(Date.parse(row.at)))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .slice(0, limit);
    return rows;
  }
}
