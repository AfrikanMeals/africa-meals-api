import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { OrderModel, OrderStatusEnum } from '@schemas/order.schema';
import { Model, Types } from 'mongoose';
import { VendorNotificationDispatchService } from '@modules/vendor-notifications/vendor-notification-dispatch.service';
import { objectIdStringFromRef } from 'src/utils/mongoose-ref.util';
import {
  isVendorOrderAlertStillRinging,
  shouldSendVendorOrderAlertReminder,
  VENDOR_ORDER_ALERT_MAX_REMINDERS,
  VENDOR_ORDER_ALERT_REMIND_INTERVAL_MS,
} from './vendor-order-alert.util';

/**
 * Call-like vendeur : ring FCM à paiement + rappels jusqu’à Accept/Reject, puis stop.
 */
@Injectable()
export class VendorOrderAlertService {
  private readonly logger = new Logger(VendorOrderAlertService.name);

  constructor(
    @InjectModel(OrderModel.name)
    private readonly orderModel: Model<OrderModel>,
    private readonly vendorDispatch: VendorNotificationDispatchService,
  ) {}

  /** Ring initial (après notif payée). Met à jour lastRemindedAt sans incrémenter le compteur rappels. */
  async ringForPaidOrder(orderId: string): Promise<void> {
    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) return;

    const order = await this.orderModel
      .findById(new Types.ObjectId(oid))
      .populate('store', 'name')
      .lean()
      .exec();
    if (!order || !isVendorOrderAlertStillRinging(order)) return;

    const storeId = objectIdStringFromRef(order.store);
    if (!storeId) return;

    const storeName = this.readStoreName(order.store);
    await this.vendorDispatch.pushVendorOrderCallAlert({
      storeId,
      orderId: oid,
      action: 'ring',
      title: 'Nouvelle commande',
      body: storeName
        ? `${storeName} — une commande attend votre acceptation.`
        : 'Une commande attend votre acceptation.',
      storeName,
      reason: 'order_paid',
      customerUserId: objectIdStringFromRef(order.user),
      logTag: 'vendor_order_alert_ring',
    });

    await this.orderModel
      .updateOne(
        { _id: new Types.ObjectId(oid) },
        { $set: { vendorAlertLastRemindedAt: new Date() } },
      )
      .exec();
  }

  /** Stop après Accept / Reject / annulation. */
  async stopForOrder(orderId: string): Promise<void> {
    const oid = orderId.trim();
    if (!Types.ObjectId.isValid(oid)) return;

    const order = await this.orderModel
      .findById(new Types.ObjectId(oid))
      .populate('store', 'name')
      .lean()
      .exec();
    if (!order) return;

    const storeId = objectIdStringFromRef(order.store);
    if (!storeId) return;

    const storeName = this.readStoreName(order.store);
    await this.vendorDispatch.pushVendorOrderCallAlert({
      storeId,
      orderId: oid,
      action: 'stop',
      title: 'Commande traitée',
      body: 'Alerte commande terminée.',
      storeName,
      reason: 'vendor_alert_stop',
      customerUserId: objectIdStringFromRef(order.user),
      logTag: 'vendor_order_alert_stop',
    });
  }

  /** Cron : rappels ring pour commandes encore en attente vendeur. */
  async processReminderPass(): Promise<{ scanned: number; reminded: number }> {
    const now = Date.now();
    const paidStatuses = [
      OrderStatusEnum.PAIED,
      OrderStatusEnum.AWAITING_CASH,
    ];
    const candidates = await this.orderModel
      .find({
        status: { $in: paidStatuses },
        vendorAcceptedAt: { $exists: false },
        vendorPaidNotifiedAt: { $exists: true },
      })
      .select(
        '_id store user status vendorAcceptedAt vendorAlertRemindCount vendorAlertLastRemindedAt',
      )
      .populate('store', 'name')
      .limit(80)
      .lean()
      .exec();

    let reminded = 0;
    for (const order of candidates) {
      if (!isVendorOrderAlertStillRinging(order)) continue;
      const count = Number(order.vendorAlertRemindCount ?? 0) || 0;
      const lastRaw = order.vendorAlertLastRemindedAt;
      const lastMs =
        lastRaw instanceof Date
          ? lastRaw.getTime()
          : typeof lastRaw === 'string' && lastRaw
            ? Date.parse(lastRaw)
            : null;
      if (
        !shouldSendVendorOrderAlertReminder({
          nowMs: now,
          lastRemindedAtMs:
            lastMs != null && Number.isFinite(lastMs) ? lastMs : null,
          remindCount: count,
          intervalMs: VENDOR_ORDER_ALERT_REMIND_INTERVAL_MS,
          maxReminders: VENDOR_ORDER_ALERT_MAX_REMINDERS,
        })
      ) {
        continue;
      }

      const oid = String(order._id);
      const storeId = objectIdStringFromRef(order.store);
      if (!storeId) continue;
      const storeName = this.readStoreName(order.store);

      await this.vendorDispatch.pushVendorOrderCallAlert({
        storeId,
        orderId: oid,
        action: 'ring',
        title: 'Commande en attente',
        body: storeName
          ? `${storeName} — acceptez ou refusez la commande.`
          : 'Acceptez ou refusez la commande.',
        storeName,
        reason: 'reminder',
        customerUserId: objectIdStringFromRef(order.user),
        logTag: 'vendor_order_alert_remind',
      });

      await this.orderModel
        .updateOne(
          { _id: order._id },
          {
            $set: { vendorAlertLastRemindedAt: new Date() },
            $inc: { vendorAlertRemindCount: 1 },
          },
        )
        .exec();
      reminded += 1;
    }

    return { scanned: candidates.length, reminded };
  }

  private readStoreName(store: unknown): string | undefined {
    if (store && typeof store === 'object' && 'name' in store) {
      const nm = (store as { name?: unknown }).name;
      if (typeof nm === 'string' && nm.trim()) return nm.trim();
    }
    return undefined;
  }
}
