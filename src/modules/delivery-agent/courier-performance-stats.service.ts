import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  DeliveryAgentPerformanceStatsModel,
} from '@schemas/delivery-agent-performance-stats.schema';
import { Model, Types } from 'mongoose';
import {
  deriveCourierPerformance,
  type CourierPerformanceCounters,
  type CourierPerformanceDerived,
} from './courier-performance.util';

export type CourierPerformanceStatsPayload = CourierPerformanceDerived &
  CourierPerformanceCounters & {
    deliveryAgentId: string;
  };

type IncFields = Partial<
  Record<
    | 'offersPresented'
    | 'offersAccepted'
    | 'offersRejected'
    | 'offersExpired'
    | 'marketplaceNotified'
    | 'marketplaceClaims'
    | 'marketplaceMissed'
    | 'unassignByCourier'
    | 'unassignByOther'
    | 'completedDeliveries'
    | 'totalDeliveryDurationSec'
    | 'totalDistanceKm',
    number
  >
>;

@Injectable()
export class CourierPerformanceStatsService {
  private readonly logger = new Logger(CourierPerformanceStatsService.name);

  constructor(
    @InjectModel(DeliveryAgentPerformanceStatsModel.name)
    private readonly _stats: Model<DeliveryAgentPerformanceStatsModel>,
  ) {}

  async getOrCreate(
    agentUserId: string,
  ): Promise<CourierPerformanceStatsPayload | null> {
    const id = String(agentUserId ?? '').trim();
    if (!Types.ObjectId.isValid(id)) return null;
    const oid = new Types.ObjectId(id);
    let doc = await this._stats.findOne({ deliveryAgent: oid }).lean().exec();
    if (!doc) {
      try {
        await this._stats.create({ deliveryAgent: oid });
      } catch {
        // race unique index
      }
      doc = await this._stats.findOne({ deliveryAgent: oid }).lean().exec();
    }
    if (!doc) return null;
    return this.toPayload(id, doc as CourierPerformanceCounters);
  }

  async getMany(
    agentUserIds: string[],
  ): Promise<Map<string, CourierPerformanceStatsPayload>> {
    const out = new Map<string, CourierPerformanceStatsPayload>();
    const ids = [
      ...new Set(
        agentUserIds.map((x) => String(x ?? '').trim()).filter((x) =>
          Types.ObjectId.isValid(x),
        ),
      ),
    ];
    if (ids.length === 0) return out;
    const rows = await this._stats
      .find({
        deliveryAgent: { $in: ids.map((id) => new Types.ObjectId(id)) },
      })
      .lean()
      .exec();
    for (const row of rows) {
      const uid = String(
        (row as { deliveryAgent?: unknown }).deliveryAgent ?? '',
      );
      if (!uid) continue;
      out.set(uid, this.toPayload(uid, row as CourierPerformanceCounters));
    }
    return out;
  }

  async increment(agentUserId: string, fields: IncFields): Promise<void> {
    const id = String(agentUserId ?? '').trim();
    if (!Types.ObjectId.isValid(id)) return;
    const $inc: Record<string, number> = {};
    for (const [k, v] of Object.entries(fields)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n === 0) continue;
      $inc[k] = n;
    }
    if (Object.keys($inc).length === 0) return;
    try {
      await this._stats
        .updateOne(
          { deliveryAgent: new Types.ObjectId(id) },
          { $inc, $setOnInsert: { deliveryAgent: new Types.ObjectId(id) } },
          { upsert: true },
        )
        .exec();
    } catch (e) {
      this.logger.warn(
        `increment stats agent=${id}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  async recordOfferPresented(agentUserId: string): Promise<void> {
    await this.increment(agentUserId, { offersPresented: 1 });
  }

  async recordOfferAccepted(agentUserId: string): Promise<void> {
    await this.increment(agentUserId, { offersAccepted: 1 });
  }

  async recordOfferRejected(agentUserId: string): Promise<void> {
    await this.increment(agentUserId, { offersRejected: 1 });
  }

  async recordOfferExpired(agentUserId: string): Promise<void> {
    await this.increment(agentUserId, { offersExpired: 1 });
  }

  async recordMarketplaceNotified(agentUserId: string): Promise<void> {
    await this.increment(agentUserId, { marketplaceNotified: 1 });
  }

  async recordMarketplaceClaim(agentUserId: string): Promise<void> {
    await this.increment(agentUserId, { marketplaceClaims: 1 });
  }

  async recordMarketplaceMissed(agentUserIds: string[]): Promise<void> {
    await Promise.all(
      agentUserIds.map((id) => this.increment(id, { marketplaceMissed: 1 })),
    );
  }

  async recordUnassignByCourier(agentUserId: string): Promise<void> {
    await this.increment(agentUserId, { unassignByCourier: 1 });
  }

  async recordUnassignByOther(agentUserId: string): Promise<void> {
    await this.increment(agentUserId, { unassignByOther: 1 });
  }

  async recordCompletedDelivery(args: {
    agentUserId: string;
    durationSec?: number | null;
    distanceKm?: number | null;
  }): Promise<void> {
    const fields: IncFields = { completedDeliveries: 1 };
    if (
      args.durationSec != null &&
      Number.isFinite(args.durationSec) &&
      args.durationSec > 0
    ) {
      fields.totalDeliveryDurationSec = Math.round(args.durationSec);
    }
    if (
      args.distanceKm != null &&
      Number.isFinite(args.distanceKm) &&
      args.distanceKm > 0
    ) {
      fields.totalDistanceKm = Math.round(args.distanceKm * 100) / 100;
    }
    await this.increment(args.agentUserId, fields);
  }

  private toPayload(
    deliveryAgentId: string,
    c: CourierPerformanceCounters,
  ): CourierPerformanceStatsPayload {
    return {
      deliveryAgentId,
      offersPresented: Number(c.offersPresented ?? 0),
      offersAccepted: Number(c.offersAccepted ?? 0),
      offersRejected: Number(c.offersRejected ?? 0),
      offersExpired: Number(c.offersExpired ?? 0),
      marketplaceNotified: Number(c.marketplaceNotified ?? 0),
      marketplaceClaims: Number(c.marketplaceClaims ?? 0),
      marketplaceMissed: Number(c.marketplaceMissed ?? 0),
      unassignByCourier: Number(c.unassignByCourier ?? 0),
      unassignByOther: Number(c.unassignByOther ?? 0),
      completedDeliveries: Number(c.completedDeliveries ?? 0),
      totalDeliveryDurationSec: Number(c.totalDeliveryDurationSec ?? 0),
      totalDistanceKm: Number(c.totalDistanceKm ?? 0),
      ...deriveCourierPerformance(c),
    };
  }
}
