import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  EngagementPerformanceChannel,
  EngagementPerformanceEventModel,
  EngagementPerformanceEventType,
} from '@schemas/engagement-performance-event.schema';
import {
  EngagementPerformanceDailyModel,
} from '@schemas/engagement-performance-daily.schema';
import { UserModel, UserTypeEnum } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { QueryEngagementPerformancesDto } from './dto/query-engagement-performances.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_DAYS = 30;

function assertAdmin(user: UserModel) {
  if (user.type !== UserTypeEnum.ADMIN) {
    throw new ForbiddenException('admin_only');
  }
}

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

function resolveRange(query: QueryEngagementPerformancesDto): {
  from: Date;
  to: Date;
  fromKey: string;
  toKey: string;
} {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
  return {
    from: startOfUtcDay(from),
    to: startOfUtcDay(to),
    fromKey: dateKey(from),
    toKey: dateKey(to),
  };
}

export type EngagementOverviewResponse = {
  range: { from: string; to: string };
  pushReco: {
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    dismissed: number;
    unsubscribed: number;
    orders24h: number;
    orders48h: number;
    revenueAmount: number;
    currency: string;
    deliverabilityPercent: number;
    openRatePercent: number;
    clickRatePercent: number;
    conversion24hPercent: number;
    dismissRatePercent: number;
  };
  timeseries: Array<{
    date: string;
    sent: number;
    opened: number;
    clicked: number;
    orders24h: number;
  }>;
};

@Injectable()
export class EngagementPerformancesService {
  private readonly logger = new Logger(EngagementPerformancesService.name);

  constructor(
    @InjectModel(EngagementPerformanceEventModel.name)
    private readonly eventModel: Model<EngagementPerformanceEventModel>,
    @InjectModel(EngagementPerformanceDailyModel.name)
    private readonly dailyModel: Model<EngagementPerformanceDailyModel>,
  ) {}

  async recordEvent(input: {
    channel: EngagementPerformanceChannel;
    event: EngagementPerformanceEventType;
    userId?: string | null;
    scheduleId?: string;
    campaignId?: string;
    candidateType?: string;
    refType?: string;
    refId?: string;
    cuisineTags?: string[];
    copySource?: string;
    region?: string;
    skipReason?: string;
    revenueAmount?: number | null;
    currency?: string;
    metadata?: Record<string, unknown>;
    occurredAt?: Date;
  }): Promise<void> {
    try {
      await this.eventModel.create({
        channel: input.channel,
        event: input.event,
        userId: input.userId ?? null,
        scheduleId: input.scheduleId ?? '',
        campaignId: input.campaignId ?? '',
        candidateType: input.candidateType ?? '',
        refType: input.refType ?? '',
        refId: input.refId ?? '',
        cuisineTags: input.cuisineTags ?? [],
        copySource: input.copySource ?? '',
        region: input.region ?? '',
        skipReason: input.skipReason ?? '',
        revenueAmount: input.revenueAmount ?? null,
        currency: input.currency ?? '',
        metadata: input.metadata ?? {},
        occurredAt: input.occurredAt ?? new Date(),
      });
    } catch (err) {
      this.logger.warn(
        `recordEvent failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async countEvents(
    channel: EngagementPerformanceChannel,
    event: EngagementPerformanceEventType,
    from: Date,
    to: Date,
    extra: Record<string, unknown> = {},
  ): Promise<number> {
    return this.eventModel.countDocuments({
      channel,
      event,
      occurredAt: { $gte: from, $lte: new Date(to.getTime() + DAY_MS - 1) },
      ...extra,
    });
  }

  async getOverview(
    user: UserModel,
    query: QueryEngagementPerformancesDto,
  ): Promise<EngagementOverviewResponse> {
    assertAdmin(user);
    const { from, to, fromKey, toKey } = resolveRange(query);
    const channel = EngagementPerformanceChannel.PUSH_RECO;
    const regionFilter = query.region?.trim()
      ? { region: query.region.trim() }
      : {};

    const [
      sent,
      delivered,
      opened,
      clicked,
      dismissed,
      unsubscribed,
      orders24h,
      orders48h,
    ] = await Promise.all([
      this.countEvents(channel, EngagementPerformanceEventType.SENT, from, to, regionFilter),
      this.countEvents(channel, EngagementPerformanceEventType.DELIVERED, from, to, regionFilter),
      this.countEvents(channel, EngagementPerformanceEventType.OPEN, from, to, regionFilter),
      this.countEvents(channel, EngagementPerformanceEventType.CLICK, from, to, regionFilter),
      this.countEvents(channel, EngagementPerformanceEventType.DISMISS, from, to, regionFilter),
      this.countEvents(channel, EngagementPerformanceEventType.UNSUBSCRIBE, from, to, regionFilter),
      this.countEvents(channel, EngagementPerformanceEventType.ORDER_24H, from, to, regionFilter),
      this.countEvents(channel, EngagementPerformanceEventType.ORDER_48H, from, to, regionFilter),
    ]);

    const revenueAgg = await this.eventModel.aggregate<{ total: number; currency: string }>([
      {
        $match: {
          channel,
          event: EngagementPerformanceEventType.ORDER_24H,
          occurredAt: { $gte: from, $lte: new Date(to.getTime() + DAY_MS - 1) },
          ...regionFilter,
        },
      },
      {
        $group: {
          _id: '$currency',
          total: { $sum: { $ifNull: ['$revenueAmount', 0] } },
        },
      },
    ]);

    const revenueRow = revenueAgg[0];
    const deliverabilityBase = sent || delivered;
    const openBase = delivered || sent;

    const dailyRows = await this.dailyModel
      .find({
        channel,
        date: { $gte: fromKey, $lte: toKey },
        ...(query.region?.trim() ? { region: query.region.trim() } : {}),
      })
      .sort({ date: 1 })
      .lean()
      .exec();

    const timeseries =
      dailyRows.length > 0
        ? dailyRows.map((row) => ({
            date: row.date,
            sent: row.sent ?? 0,
            opened: row.opened ?? 0,
            clicked: row.clicked ?? 0,
            orders24h: row.orders24h ?? 0,
          }))
        : await this.buildTimeseriesFromEvents(channel, from, to, regionFilter);

    return {
      range: { from: fromKey, to: toKey },
      pushReco: {
        sent,
        delivered,
        opened,
        clicked,
        dismissed,
        unsubscribed,
        orders24h,
        orders48h,
        revenueAmount: round2(revenueRow?.total ?? 0),
        currency: revenueRow?.currency || 'CAD',
        deliverabilityPercent: percent(delivered, deliverabilityBase),
        openRatePercent: percent(opened, openBase),
        clickRatePercent: percent(clicked, opened),
        conversion24hPercent: percent(orders24h, sent),
        dismissRatePercent: percent(dismissed, openBase),
      },
      timeseries,
    };
  }

  private async buildTimeseriesFromEvents(
    channel: EngagementPerformanceChannel,
    from: Date,
    to: Date,
    regionFilter: Record<string, unknown>,
  ) {
    const rows = await this.eventModel.aggregate<{
      _id: string;
      sent: number;
      opened: number;
      clicked: number;
      orders24h: number;
    }>([
      {
        $match: {
          channel,
          occurredAt: { $gte: from, $lte: new Date(to.getTime() + DAY_MS - 1) },
          ...regionFilter,
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$occurredAt', timezone: 'UTC' },
          },
          sent: {
            $sum: {
              $cond: [{ $eq: ['$event', EngagementPerformanceEventType.SENT] }, 1, 0],
            },
          },
          opened: {
            $sum: {
              $cond: [{ $eq: ['$event', EngagementPerformanceEventType.OPEN] }, 1, 0],
            },
          },
          clicked: {
            $sum: {
              $cond: [{ $eq: ['$event', EngagementPerformanceEventType.CLICK] }, 1, 0],
            },
          },
          orders24h: {
            $sum: {
              $cond: [{ $eq: ['$event', EngagementPerformanceEventType.ORDER_24H] }, 1, 0],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    return rows.map((row) => ({
      date: row._id,
      sent: row.sent,
      opened: row.opened,
      clicked: row.clicked,
      orders24h: row.orders24h,
    }));
  }

  async getPushRecoDetail(user: UserModel, query: QueryEngagementPerformancesDto) {
    assertAdmin(user);
    const overview = await this.getOverview(user, query);
    const { from, to } = resolveRange(query);
    const channel = EngagementPerformanceChannel.PUSH_RECO;
    const match: Record<string, unknown> = {
      channel,
      occurredAt: { $gte: from, $lte: new Date(to.getTime() + DAY_MS - 1) },
    };
    if (query.region?.trim()) match.region = query.region.trim();
    if (query.candidateType?.trim()) match.candidateType = query.candidateType.trim();
    if (query.copySource?.trim()) match.copySource = query.copySource.trim();

    const [byCandidateType, byCopySource, skippedByReason, funnel] =
      await Promise.all([
        this.eventModel.aggregate([
          { $match: match },
          {
            $group: {
              _id: { candidateType: '$candidateType', event: '$event' },
              count: { $sum: 1 },
            },
          },
        ]),
        this.eventModel.aggregate([
          { $match: { ...match, copySource: { $ne: '' } } },
          {
            $group: {
              _id: { copySource: '$copySource', event: '$event' },
              count: { $sum: 1 },
            },
          },
        ]),
        this.eventModel.aggregate([
          {
            $match: {
              ...match,
              event: EngagementPerformanceEventType.SKIPPED,
            },
          },
          { $group: { _id: '$skipReason', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),
        this.eventModel.aggregate([
          { $match: match },
          { $group: { _id: '$event', count: { $sum: 1 } } },
        ]),
      ]);

    return {
      ...overview,
      breakdowns: {
        byCandidateType,
        byCopySource,
        skippedByReason: skippedByReason.map((row) => ({
          reason: row._id || 'unknown',
          count: row.count,
        })),
        funnel: funnel.map((row) => ({ event: row._id, count: row.count })),
      },
    };
  }

  async aggregateDailyForDate(date: Date): Promise<void> {
    const dayStart = startOfUtcDay(date);
    const dayEnd = new Date(dayStart.getTime() + DAY_MS - 1);
    const key = dateKey(dayStart);
    const channel = EngagementPerformanceChannel.PUSH_RECO;

    const counts = await this.eventModel.aggregate([
      {
        $match: {
          channel,
          occurredAt: { $gte: dayStart, $lte: dayEnd },
        },
      },
      { $group: { _id: '$event', count: { $sum: 1 } } },
    ]);

    const map = new Map<string, number>();
    for (const row of counts) {
      map.set(String(row._id), row.count);
    }

    const skipped = await this.eventModel.aggregate([
      {
        $match: {
          channel,
          event: EngagementPerformanceEventType.SKIPPED,
          occurredAt: { $gte: dayStart, $lte: dayEnd },
        },
      },
      { $group: { _id: '$skipReason', count: { $sum: 1 } } },
    ]);

    const skippedByReason: Record<string, number> = {};
    for (const row of skipped) {
      skippedByReason[String(row._id || 'unknown')] = row.count;
    }

    const revenueAgg = await this.eventModel.aggregate([
      {
        $match: {
          channel,
          event: EngagementPerformanceEventType.ORDER_24H,
          occurredAt: { $gte: dayStart, $lte: dayEnd },
        },
      },
      {
        $group: {
          _id: '$currency',
          total: { $sum: { $ifNull: ['$revenueAmount', 0] } },
        },
      },
    ]);

    await this.dailyModel.updateOne(
      { date: key, channel, region: '' },
      {
        $set: {
          sent: map.get(EngagementPerformanceEventType.SENT) ?? 0,
          delivered: map.get(EngagementPerformanceEventType.DELIVERED) ?? 0,
          opened: map.get(EngagementPerformanceEventType.OPEN) ?? 0,
          clicked: map.get(EngagementPerformanceEventType.CLICK) ?? 0,
          dismissed: map.get(EngagementPerformanceEventType.DISMISS) ?? 0,
          unsubscribed: map.get(EngagementPerformanceEventType.UNSUBSCRIBE) ?? 0,
          orders24h: map.get(EngagementPerformanceEventType.ORDER_24H) ?? 0,
          orders48h: map.get(EngagementPerformanceEventType.ORDER_48H) ?? 0,
          revenueAmount: round2(revenueAgg[0]?.total ?? 0),
          currency: revenueAgg[0]?._id || 'CAD',
          skippedByReason,
        },
      },
      { upsert: true },
    );
  }
}
