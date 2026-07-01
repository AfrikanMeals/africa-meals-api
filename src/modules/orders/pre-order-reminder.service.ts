import { NotificationsService } from '@modules/notifications/notifications.service';
import { SupportedCountriesService } from '@modules/supported-countries/supported-countries.service';
import {
  resolveEffectiveTimezone,
} from '@modules/supported-countries/region-timezone.util';
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  OrderModel,
  OrderStatusEnum,
} from '@schemas/order.schema';
import { StoreModel } from '@schemas/store.schema';
import dayjs = require('dayjs');
import utc = require('dayjs/plugin/utc');
import timezone = require('dayjs/plugin/timezone');
import { Model, Types } from 'mongoose';
import { OrdersService } from './orders.service';

dayjs.extend(utc);
dayjs.extend(timezone);

export type PreOrderReminderPassResult = {
  scanned: number;
  customerNotified: number;
  vendorNotified: number;
  promoted: number;
  skipped: number;
};

const REMINDER_KEYS = ['d-3', 'd-2', 'd-1', 'd-day'] as const;

type PreOrderReminderScanDoc = {
  _id: unknown;
  scheduledAt?: Date;
  store?: unknown;
  user?: unknown;
  preOrderRemindersSent?: string[];
  preOrderVendorRemindersSent?: string[];
  status?: string;
};

@Injectable()
export class PreOrderReminderService {
  private readonly _logger = new Logger(PreOrderReminderService.name);

  constructor(
    @InjectModel(OrderModel.name)
    private readonly _orderModel: Model<OrderModel>,
    @InjectModel(StoreModel.name)
    private readonly _storeModel: Model<StoreModel>,
    private readonly _notifications: NotificationsService,
    private readonly _supportedCountries: SupportedCountriesService,
    @Inject(forwardRef(() => OrdersService))
    private readonly _ordersService: OrdersService,
  ) {}

  async runReminderPass(): Promise<PreOrderReminderPassResult> {
    const todayStartUtc = dayjs().utc().startOf('day').toDate();
    const scanEndUtc = dayjs().utc().add(3, 'day').endOf('day').toDate();

    const orders = await this._orderModel
      .find({
        isPreOrder: true,
        scheduledAt: { $gte: todayStartUtc, $lte: scanEndUtc },
        status: {
          $nin: [
            OrderStatusEnum.CANCELLED,
            OrderStatusEnum.COMPLETED,
          ],
        },
      })
      .select(
        'user scheduledAt preOrderRemindersSent preOrderVendorRemindersSent preOrderPromotedAt store status items totalPrice currency pickupCode vendorAcceptedAt',
      )
      .limit(500)
      .lean()
      .exec();

    const result: PreOrderReminderPassResult = {
      scanned: orders.length,
      customerNotified: 0,
      vendorNotified: 0,
      promoted: 0,
      skipped: 0,
    };

    for (const order of orders) {
      try {
        await this.processOrderReminder(
          order as PreOrderReminderScanDoc,
          result,
        );
      } catch (err) {
        this._logger.warn(
          `Pre-order reminder failed order=${String(order._id)}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        result.skipped++;
      }
    }

    return result;
  }

  private async processOrderReminder(
    order: PreOrderReminderScanDoc,
    result: PreOrderReminderPassResult,
  ): Promise<void> {
    const scheduledAt = order.scheduledAt;
    if (!scheduledAt) {
      result.skipped++;
      return;
    }

    const storeId = String(
      (order.store as { toString?: () => string })?.toString?.() ??
        order.store ??
        '',
    );
    if (!Types.ObjectId.isValid(storeId)) {
      result.skipped++;
      return;
    }

    const store = await this._storeModel
      .findById(storeId)
      .select('name region timezone')
      .lean()
      .exec();
    if (!store) {
      result.skipped++;
      return;
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
    const scheduledDay = dayjs(scheduledAt).tz(tz).startOf('day');
    const today = dayjs().tz(tz).startOf('day');
    const daysUntil = scheduledDay.diff(today, 'day');

    let key: (typeof REMINDER_KEYS)[number] | null = null;
    if (daysUntil === 3) key = 'd-3';
    else if (daysUntil === 2) key = 'd-2';
    else if (daysUntil === 1) key = 'd-1';
    else if (daysUntil === 0) key = 'd-day';

    if (!key) {
      result.skipped++;
      return;
    }

    const scheduledAtLabel = dayjs(scheduledAt)
      .tz(tz)
      .format('DD/MM/YYYY HH:mm');

    const customerSent = await this.maybeNotifyCustomer(
      order,
      key,
      daysUntil,
      storeId,
      String(store.name ?? 'Restaurant').trim(),
    );
    if (customerSent) result.customerNotified++;

    const vendorSent = await this.maybeNotifyVendor(
      order,
      key,
      daysUntil,
      scheduledAtLabel,
      storeId,
    );
    if (vendorSent) result.vendorNotified++;

    if (key === 'd-day') {
      const promoted = await this.maybePromoteOnDDay(String(order._id));
      if (promoted) result.promoted++;
    }

    if (!customerSent && !vendorSent && key !== 'd-day') {
      result.skipped++;
    }
  }

  private async maybeNotifyCustomer(
    order: Pick<
      PreOrderReminderScanDoc,
      '_id' | 'user' | 'preOrderRemindersSent'
    >,
    key: (typeof REMINDER_KEYS)[number],
    daysUntil: number,
    storeId: string,
    storeName: string,
  ): Promise<boolean> {
    const sent = new Set(order.preOrderRemindersSent ?? []);
    if (sent.has(key)) return false;

    const userId = String(order.user ?? '');
    if (!userId) return false;

    const title =
      key === 'd-day'
        ? `Pré-commande aujourd'hui — ${storeName}`
        : `Rappel pré-commande — ${storeName}`;
    const body =
      key === 'd-day'
        ? `Votre repas est prévu aujourd'hui. Consultez les détails dans Pro-Orders.`
        : `Votre pré-commande chez ${storeName} arrive dans ${daysUntil} jour(s).`;

    await this._notifications.sendMulticastNotification({
      recipientUserIds: [userId],
      title,
      body,
      data: {
        type: 'pre_order_reminder',
        reminderKey: key,
        orderId: String(order._id),
        storeId,
        audience: 'customer',
      },
    });
    await this._orderModel.updateOne(
      { _id: order._id },
      { $addToSet: { preOrderRemindersSent: key } },
    );
    return true;
  }

  private async maybeNotifyVendor(
    order: Pick<
      PreOrderReminderScanDoc,
      '_id' | 'preOrderVendorRemindersSent'
    >,
    key: (typeof REMINDER_KEYS)[number],
    daysUntil: number,
    scheduledAtLabel: string,
    storeId: string,
  ): Promise<boolean> {
    const sent = new Set(order.preOrderVendorRemindersSent ?? []);
    if (sent.has(key)) return false;

    const fullOrder = await this._orderModel
      .findById(order._id)
      .populate({ path: 'store', select: 'name currency' })
      .exec();
    if (!fullOrder) return false;

    this._ordersService.notifyStoreVendorsForPreOrderVendorReminder(
      fullOrder,
      {
        reminderKey: key,
        daysUntil,
        scheduledAtLabel,
      },
    );

    await this._orderModel.updateOne(
      { _id: order._id },
      { $addToSet: { preOrderVendorRemindersSent: key } },
    );
    return true;
  }

  private async maybePromoteOnDDay(orderId: string): Promise<boolean> {
    const doc = await this._orderModel
      .findById(orderId)
      .select('preOrderPromotedAt isPreOrder scheduledAt')
      .lean()
      .exec();
    if (!doc?.isPreOrder || !doc.scheduledAt) return false;

    const already = doc.preOrderPromotedAt != null;
    await this._ordersService.promotePreOrderOnDDay(orderId);
    return !already;
  }
}
