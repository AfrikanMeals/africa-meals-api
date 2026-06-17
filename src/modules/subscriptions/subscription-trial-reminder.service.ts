import { NotificationsService } from '@modules/notifications/notifications.service';
import { DomainEventPublisherService } from '../../common/domain-events/domain-event-publisher.service';
import { domainEventIdFromTrialReminder } from '../../common/domain-events/domain-event-id.util';
import { isDomainEventsEnabled } from '@modules/domain-event-handlers/domain-event-handlers.util';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { SubscriptionPlanModel } from '@schemas/subscription-plan.schema';
import { VendorSubscriptionModel } from '@schemas/vendor-subscription.schema';
import { SubscriptionTrialEndingPayload } from '../../common/domain-events/payloads/subscription-domain-event.payloads';
import dayjs = require('dayjs');
import utc = require('dayjs/plugin/utc');
import timezone = require('dayjs/plugin/timezone');
import { Model, Types } from 'mongoose';
import { VendorSubscriptionEmailService } from './vendor-subscription-email.service';

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
    private readonly subscriptionEmails: VendorSubscriptionEmailService,
    private readonly config: ConfigService,
    @Optional()
    private readonly domainPublisher?: DomainEventPublisherService,
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
        const ctx = await this.subscriptionEmails.buildContextFromSubscription(
          sub as Record<string, unknown>,
        );
        if (ctx) {
          void this.subscriptionEmails.notifyPlanExpiration(ctx).catch((e) => {
            this.logger.warn(
              `Trial expiration email failed sub=${ctx.subscriptionId}: ${
                e instanceof Error ? e.message : String(e)
              }`,
            );
          });
        }
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
      const subId = String(sub._id);

      if (isDomainEventsEnabled(this.config) && this.domainPublisher) {
        const publishResult = await this.domainPublisher.publish({
          id: domainEventIdFromTrialReminder(subId, daysLeft),
          type: 'subscription.trial.ending',
          payload: {
            userId: ownerId,
            subscriptionId: subId,
            storeId: String((sub as { store?: Types.ObjectId }).store ?? '')
              .trim() || undefined,
            planName,
            daysRemaining: daysLeft,
            trialEndsAt: trialEnd.toISOString(),
          },
          metadata: { source: 'subscription-trial-cron' },
        });
        if (publishResult.mode === 'duplicate') {
          result.skipped++;
          continue;
        }
        if (!publishResult.ok) {
          this.logger.warn(
            `Trial reminder publish skipped sub=${subId} days=${daysLeft} mode=${publishResult.mode}`,
          );
          result.skipped++;
          continue;
        }
        result.reminded++;
        continue;
      }

      await this.processTrialEndingReminder({
        userId: ownerId,
        subscriptionId: subId,
        storeId: String((sub as { store?: Types.ObjectId }).store ?? '')
          .trim() || undefined,
        planName,
        daysRemaining: daysLeft,
        trialEndsAt: trialEnd.toISOString(),
      });
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

  /** EDA-009 : envoi unitaire déclenché par événement domaine. */
  async sendTrialEndingReminder(payload: {
    userId: string;
    storeId?: string;
    trialEndsAt: string;
  }): Promise<void> {
    await this.processTrialEndingReminder({
      userId: payload.userId,
      subscriptionId: '',
      storeId: payload.storeId,
      planName: 'Abonnement',
      daysRemaining: 1,
      trialEndsAt: payload.trialEndsAt,
    });
  }

  async processTrialEndingReminder(
    payload: SubscriptionTrialEndingPayload,
  ): Promise<void> {
    const subId = payload.subscriptionId?.trim();
    if (!subId || !Types.ObjectId.isValid(subId)) return;

    const sub = await this.vendorSubModel.findById(subId).lean().exec();
    if (!sub) return;

    const sent =
      (sub as { trialRemindersSent?: number[] }).trialRemindersSent ?? [];
    if (sent.includes(payload.daysRemaining)) return;

    await this.notifications.notifyVendorSubscriptionTrialEnding({
      recipientUserId: payload.userId,
      subscriptionId: subId,
      storeId: payload.storeId ?? '',
      planName: payload.planName,
      daysRemaining: payload.daysRemaining,
      trialEndsAt: payload.trialEndsAt,
    });

    await this.vendorSubModel
      .updateOne(
        { _id: subId },
        { $addToSet: { trialRemindersSent: payload.daysRemaining } },
      )
      .exec();
  }
}
