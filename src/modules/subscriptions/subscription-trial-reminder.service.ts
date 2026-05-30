import { NotificationsService } from '@modules/notifications/notifications.service';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { SubscriptionPlanModel } from '@schemas/subscription-plan.schema';
import { VendorSubscriptionModel } from '@schemas/vendor-subscription.schema';
import dayjs = require('dayjs');
import utc = require('dayjs/plugin/utc');
import timezone = require('dayjs/plugin/timezone');
import { Model, Types } from 'mongoose';

dayjs.extend(utc);
dayjs.extend(timezone);

export type SubscriptionTrialReminderPassResult = {
  scanned: number;
  expired: number;
  reminded: number;
  skipped: number;
};

@Injectable()
export class SubscriptionTrialReminderService {
  private readonly logger = new Logger(SubscriptionTrialReminderService.name);

  constructor(
    @InjectModel(VendorSubscriptionModel.name)
    private readonly vendorSubModel: Model<VendorSubscriptionModel>,
    @InjectModel(SubscriptionPlanModel.name)
    private readonly planModel: Model<SubscriptionPlanModel>,
    private readonly notifications: NotificationsService,
  ) {}

  private tz(): string {
    return (
      process.env.SUBSCRIPTION_TRIAL_REMINDER_TZ?.trim() || 'America/Montreal'
    );
  }

  async runPass(): Promise<SubscriptionTrialReminderPassResult> {
    const now = new Date();
    const result: SubscriptionTrialReminderPassResult = {
      scanned: 0,
      expired: 0,
      reminded: 0,
      skipped: 0,
    };

    const trials = await this.vendorSubModel
      .find({ isTrial: true, status: 'ACTIVE' })
      .lean()
      .exec();
    result.scanned = trials.length;

    const planIds = [
      ...new Set(
        trials
          .map((t) => String((t as { plan?: Types.ObjectId }).plan ?? ''))
          .filter((id) => Types.ObjectId.isValid(id)),
      ),
    ];
    const plans = await this.planModel
      .find({ _id: { $in: planIds } })
      .lean()
      .exec();
    const planById = new Map(
      plans.map((p) => [String(p._id), p as Record<string, unknown>]),
    );

    const today = dayjs().tz(this.tz()).startOf('day');

    for (const sub of trials) {
      const trialEndRaw = (sub as { trialEndsAt?: Date }).trialEndsAt;
      const trialEnd =
        trialEndRaw instanceof Date
          ? trialEndRaw
          : trialEndRaw
          ? new Date(String(trialEndRaw))
          : null;
      if (!trialEnd || Number.isNaN(trialEnd.getTime())) {
        result.skipped++;
        continue;
      }

      if (trialEnd.getTime() <= now.getTime()) {
        await this.vendorSubModel
          .updateOne(
            { _id: sub._id },
            { $set: { status: 'EXPIRED', endsAt: trialEnd } },
          )
          .exec();
        result.expired++;
        continue;
      }

      const daysLeft = dayjs(trialEnd)
        .tz(this.tz())
        .startOf('day')
        .diff(today, 'day');
      if (daysLeft <= 0) {
        result.skipped++;
        continue;
      }

      const plan = planById.get(
        String((sub as { plan?: Types.ObjectId }).plan),
      );
      const reminderDays = Array.isArray(
        (plan as { trialReminderDays?: number[] } | undefined)
          ?.trialReminderDays,
      )
        ? (plan as { trialReminderDays: number[] }).trialReminderDays
        : [];
      if (!reminderDays.includes(daysLeft)) {
        result.skipped++;
        continue;
      }

      const sent =
        (sub as { trialRemindersSent?: number[] }).trialRemindersSent ?? [];
      if (sent.includes(daysLeft)) {
        result.skipped++;
        continue;
      }

      const ownerId = String((sub as { owner?: Types.ObjectId }).owner ?? '');
      if (!Types.ObjectId.isValid(ownerId)) {
        result.skipped++;
        continue;
      }

      const planName = String(
        (sub as { planName?: string }).planName ??
          (plan as { name?: string } | undefined)?.name ??
          'Abonnement',
      );

      await this.notifications.notifyVendorSubscriptionTrialEnding({
        recipientUserId: ownerId,
        subscriptionId: String(sub._id),
        storeId: String((sub as { store?: Types.ObjectId }).store ?? ''),
        planName,
        daysRemaining: daysLeft,
        trialEndsAt: trialEnd.toISOString(),
      });

      await this.vendorSubModel
        .updateOne(
          { _id: sub._id },
          { $addToSet: { trialRemindersSent: daysLeft } },
        )
        .exec();
      result.reminded++;
    }

    if (result.reminded > 0 || result.expired > 0) {
      this.logger.log(
        `Trial pass: scanned=${result.scanned} reminded=${result.reminded} ` +
          `expired=${result.expired} skipped=${result.skipped}`,
      );
    }

    return result;
  }
}
