import { NotificationsService } from '@modules/notifications/notifications.service';
import { PartnerOnboardingEmailService } from '@modules/vendor-emails/partner-onboarding-email.service';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { PartnerSubscriptionPlanModel } from '@schemas/partner-subscription-plan.schema';
import { PartnerSubscriptionModel } from '@schemas/partner-subscription.schema';
import { UserModel } from '@schemas/user.schema';
import dayjs = require('dayjs');
import utc = require('dayjs/plugin/utc');
import timezone = require('dayjs/plugin/timezone');
import { Model, Types } from 'mongoose';

dayjs.extend(utc);
dayjs.extend(timezone);

export type PartnerTrialReminderPassResult = {
  scanned: number;
  expired: number;
  reminded: number;
  skipped: number;
};

/** Rappels fin d’essai + expiration auto abonnements Partner (+ e-mail). */
@Injectable()
export class PartnerSubscriptionTrialReminderService {
  private readonly logger = new Logger(
    PartnerSubscriptionTrialReminderService.name,
  );

  constructor(
    @InjectModel(PartnerSubscriptionModel.name)
    private readonly subModel: Model<PartnerSubscriptionModel>,
    @InjectModel(PartnerSubscriptionPlanModel.name)
    private readonly planModel: Model<PartnerSubscriptionPlanModel>,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    private readonly notifications: NotificationsService,
    private readonly partnerEmails: PartnerOnboardingEmailService,
  ) {}

  private tz(): string {
    return (
      process.env.PARTNER_SUBSCRIPTION_TRIAL_REMINDER_TZ?.trim() ||
      process.env.SUBSCRIPTION_TRIAL_REMINDER_TZ?.trim() ||
      'America/Montreal'
    );
  }

  async runPass(): Promise<PartnerTrialReminderPassResult> {
    const now = new Date();
    const result: PartnerTrialReminderPassResult = {
      scanned: 0,
      expired: 0,
      reminded: 0,
      skipped: 0,
    };

    // 1. Essais ACTIVE — rappel J-n ou expiration.
    const trials = await this.subModel
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
        await this.expireSubscription(sub as Record<string, unknown>);
        result.expired++;
        continue;
      }

      const plan = planById.get(String((sub as { plan?: Types.ObjectId }).plan));
      const reminderDays = Array.isArray(plan?.trialReminderDays)
        ? (plan!.trialReminderDays as number[])
            .map((d) => Number(d))
            .filter((d) => d > 0)
        : [];
      if (!reminderDays.length) {
        result.skipped++;
        continue;
      }

      const endDay = dayjs(trialEnd).tz(this.tz()).startOf('day');
      const daysLeft = endDay.diff(today, 'day');
      if (!reminderDays.includes(daysLeft)) {
        result.skipped++;
        continue;
      }

      const sent: number[] = Array.isArray(
        (sub as { trialRemindersSent?: number[] }).trialRemindersSent,
      )
        ? (sub as { trialRemindersSent: number[] }).trialRemindersSent
        : [];
      if (sent.includes(daysLeft)) {
        result.skipped++;
        continue;
      }

      const owner = await this.loadOwner(
        String((sub as { owner?: Types.ObjectId }).owner ?? ''),
      );
      if (!owner) {
        result.skipped++;
        continue;
      }

      try {
        const planName = String((sub as { planName?: string }).planName ?? '');
        const subscriptionId = String(sub._id);
        // Inbox + push + e-mail rappel.
        await this.notifications.notifyPartnerSubscriptionLifecycle({
          recipientUserId: String(owner._id),
          subscriptionId,
          kind: 'TRIAL_REMINDER',
          planName,
          daysRemaining: daysLeft,
          trialEndsAt: trialEnd.toISOString(),
        });
        void this.partnerEmails
          .notifyPartnerSubscriptionTrialReminder({
            email: String(owner.email ?? ''),
            name:
              String(owner.fullName ?? '').trim() ||
              String(owner.email ?? ''),
            planName,
            daysRemaining: daysLeft,
          })
          .catch((e) =>
            this.logger.warn(
              `Partner trial reminder email failed sub=${subscriptionId}: ${
                e instanceof Error ? e.message : String(e)
              }`,
            ),
          );
        await this.subModel
          .updateOne(
            { _id: sub._id },
            { $addToSet: { trialRemindersSent: daysLeft } },
          )
          .exec();
        result.reminded++;
      } catch (e) {
        this.logger.warn(
          `Partner trial reminder failed sub=${String(sub._id)}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        result.skipped++;
      }
    }

    // 2. Abonnements payants ACTIVE dont endsAt est passé (FREE a endsAt +50 ans → hors filtre).
    const paidExpired = await this.subModel
      .find({
        status: 'ACTIVE',
        isTrial: { $ne: true },
        endsAt: { $lte: now },
      })
      .lean()
      .exec();
    for (const sub of paidExpired) {
      await this.expireSubscription(sub as Record<string, unknown>);
      result.expired++;
      result.scanned++;
    }

    return result;
  }

  private async loadOwner(ownerId: string) {
    if (!Types.ObjectId.isValid(ownerId)) return null;
    return this.userModel
      .findById(ownerId)
      .select('fullName email')
      .lean()
      .exec();
  }

  /** Passe en EXPIRED + notifie inbox / push / e-mail. */
  private async expireSubscription(sub: Record<string, unknown>) {
    const subscriptionId = String(sub._id ?? '');
    await this.subModel
      .updateOne({ _id: sub._id }, { $set: { status: 'EXPIRED' } })
      .exec();

    const owner = await this.loadOwner(String(sub.owner ?? ''));
    if (!owner) return;

    const planName = String(sub.planName ?? '');
    try {
      await this.notifications.notifyPartnerSubscriptionLifecycle({
        recipientUserId: String(owner._id),
        subscriptionId,
        kind: 'EXPIRED',
        planName,
      });
    } catch (e) {
      this.logger.warn(
        `Partner expire push failed sub=${subscriptionId}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
    void this.partnerEmails
      .notifyPartnerSubscriptionExpired({
        email: String(owner.email ?? ''),
        name:
          String(owner.fullName ?? '').trim() || String(owner.email ?? ''),
        planName,
      })
      .catch((e) =>
        this.logger.warn(
          `Partner expire email failed sub=${subscriptionId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
      );
  }
}
