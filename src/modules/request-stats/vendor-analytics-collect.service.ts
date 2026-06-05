import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  VendorAnalyticsEventModel,
  VendorAnalyticsEventTypeEnum,
  VendorAnalyticsItemKindEnum,
} from '@schemas/vendor-analytics-event.schema';
import { Model, Types } from 'mongoose';
import { StoreService } from '../store/store.service';
import { RequestStatsStore } from './request-stats.store';

export type RecordVendorAnalyticsInput = {
  storeId: string;
  userId?: string | null;
  eventType: VendorAnalyticsEventTypeEnum;
  itemId?: string;
  itemKind?: VendorAnalyticsItemKindEnum;
  durationSec?: number;
  engagement?: string;
};

@Injectable()
export class VendorAnalyticsCollectService {
  constructor(
    private readonly store: RequestStatsStore,
    private readonly storeService: StoreService,
    @InjectModel(VendorAnalyticsEventModel.name)
    private readonly eventModel: Model<VendorAnalyticsEventModel>,
  ) {}

  async record(input: RecordVendorAnalyticsInput): Promise<{ ok: true }> {
    const storeId = String(input.storeId ?? '').trim();
    if (!Types.ObjectId.isValid(storeId)) {
      return { ok: true };
    }

    const visible = await this.storeService.isStoreVisibleOnMobileApp(storeId);
    if (!visible) {
      return { ok: true };
    }

    const userOid =
      input.userId && Types.ObjectId.isValid(input.userId)
        ? new Types.ObjectId(input.userId)
        : undefined;

    const itemOid =
      input.itemId && Types.ObjectId.isValid(input.itemId)
        ? new Types.ObjectId(input.itemId)
        : undefined;

    await this.eventModel.create({
      store: new Types.ObjectId(storeId),
      user: userOid,
      eventType: input.eventType,
      itemId: itemOid,
      itemKind: input.itemKind,
      durationSec:
        input.durationSec != null && input.durationSec > 0
          ? Math.min(Math.floor(input.durationSec), 86_400)
          : undefined,
      engagement: input.engagement?.trim().slice(0, 64) || undefined,
      source: 'mobile',
    });

    this.store.push({
      kind: 'http',
      method: 'GET',
      route: this.routeForEvent(input.eventType, input.itemId),
      storeId,
      statusCode: 200,
      durationMs: 0,
      userId: userOid?.toString() ?? null,
      source: 'api',
    });

    return { ok: true };
  }

  private routeForEvent(
    eventType: VendorAnalyticsEventTypeEnum,
    itemId?: string,
  ): string {
    switch (eventType) {
      case VendorAnalyticsEventTypeEnum.STORE_PAGE_VIEW:
        return '/mobile/store-menu';
      case VendorAnalyticsEventTypeEnum.PRODUCT_VIEW:
        return itemId ? `/mobile/products/${itemId}` : '/mobile/products/:id';
      case VendorAnalyticsEventTypeEnum.DRINK_VIEW:
        return itemId ? `/mobile/drinks/${itemId}` : '/mobile/drinks/:id';
      case VendorAnalyticsEventTypeEnum.STORE_ENGAGEMENT:
        return '/mobile/store-engagement';
      case VendorAnalyticsEventTypeEnum.STORE_SESSION:
        return '/mobile/store-session';
      default:
        return '/mobile/analytics';
    }
  }
}
