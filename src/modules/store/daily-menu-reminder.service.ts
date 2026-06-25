import { NotificationsService } from '@modules/notifications/notifications.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import {
  jsDayOfWeekInTimezone,
  resolveEffectiveTimezone,
} from '@modules/supported-countries/region-timezone.util';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AppNotificationModel,
  AppNotificationScopeEnum,
} from '@schemas/app-notification.schema';
import { StoreModel, StoreStatusEnum } from '@schemas/store.schema';
import { storeHasDailyMenuForWeekday } from '@utils/daily-menu-defined.util';
import dayjs = require('dayjs');
import utc = require('dayjs/plugin/utc');
import timezone = require('dayjs/plugin/timezone');
import { Model, Types } from 'mongoose';

dayjs.extend(utc);
dayjs.extend(timezone);

export type DailyMenuReminderPassResult = {
  scanned: number;
  notified: number;
  skippedHasMenu: number;
  skippedAlreadySent: number;
  skippedNoOwner: number;
};

@Injectable()
export class DailyMenuReminderService {
  private readonly _logger = new Logger(DailyMenuReminderService.name);

  constructor(
    @InjectModel(StoreModel.name)
    private readonly _storeModel: Model<StoreModel>,
    @InjectModel(AppNotificationModel.name)
    private readonly _appNotificationModel: Model<AppNotificationModel>,
    private readonly _notifications: NotificationsService,
    private readonly _supportedCountries: SupportedCountriesService,
  ) {}

  async runReminderPass(): Promise<DailyMenuReminderPassResult> {
    const stores = await this._storeModel
      .find({
        status: StoreStatusEnum.ACTIVE,
        owner: { $exists: true, $ne: null },
      })
      .select('name owner dailyMenuByWeekday region timezone')
      .lean()
      .exec();

    const result: DailyMenuReminderPassResult = {
      scanned: stores.length,
      notified: 0,
      skippedHasMenu: 0,
      skippedAlreadySent: 0,
      skippedNoOwner: 0,
    };

    for (const store of stores) {
      const ownerId = this.ownerIdFromStore(store);
      if (!ownerId) {
        result.skippedNoOwner++;
        continue;
      }

      const regionCode = String(store.region ?? '')
        .trim()
        .toUpperCase();
      const regionTz = regionCode
        ? await this._supportedCountries.getTimezoneForCountry(regionCode)
        : undefined;
      const tz = resolveEffectiveTimezone({
        storeTimezone: store.timezone,
        regionTimezone: regionTz,
        regionCode,
      });
      const now = dayjs().tz(tz);
      const dayOfWeek = jsDayOfWeekInTimezone(tz, now.toDate());
      const reminderDate = now.format('YYYY-MM-DD');

      if (storeHasDailyMenuForWeekday(store.dailyMenuByWeekday, dayOfWeek)) {
        result.skippedHasMenu++;
        continue;
      }

      const storeId = String(store._id);
      if (await this.wasReminderSentToday(ownerId, reminderDate, storeId)) {
        result.skippedAlreadySent++;
        continue;
      }

      await this._notifications.notifyVendorDailyMenuMissing({
        recipientUserId: ownerId,
        storeId,
        storeName: String(store.name ?? '').trim() || 'Restaurant',
        dayOfWeek,
        reminderDate,
      });
      result.notified++;
    }

    return result;
  }

  private ownerIdFromStore(store: { owner?: unknown }): string | null {
    const raw = store.owner;
    if (raw == null) return null;
    if (typeof raw === 'object' && '_id' in (raw as object)) {
      const id = String((raw as { _id: unknown })._id ?? '').trim();
      return Types.ObjectId.isValid(id) ? id : null;
    }
    const id = String(raw).trim();
    return Types.ObjectId.isValid(id) ? id : null;
  }

  private async wasReminderSentToday(
    recipientUserId: string,
    reminderDate: string,
    storeId: string,
  ): Promise<boolean> {
    const exists = await this._appNotificationModel
      .exists({
        scope: AppNotificationScopeEnum.USER,
        recipientUserId: new Types.ObjectId(recipientUserId),
        type: 'daily_menu_reminder',
        'data.reminderDate': reminderDate,
        'data.storeId': storeId,
      })
      .lean();
    return !!exists;
  }
}
