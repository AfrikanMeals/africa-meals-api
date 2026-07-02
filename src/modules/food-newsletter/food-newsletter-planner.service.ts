import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { NewsletterAutomationSettingsService } from '@modules/newsletter-automation-settings/newsletter-automation-settings.service';
import { EngagementPerformancesService } from '@modules/engagement-performances/engagement-performances.service';
import {
  EngagementPerformanceChannel,
  EngagementPerformanceEventType,
} from '@schemas/engagement-performance-event.schema';
import { FoodNewsletterCandidateModel } from '@schemas/food-newsletter-candidate.schema';
import {
  FoodNewsletterScheduleModel,
  FoodNewsletterScheduleStatus,
} from '@schemas/food-newsletter-schedule.schema';
import { UserModel } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { FoodNewsletterCopyService } from './food-newsletter-copy.service';
import { FoodNewsletterDeliveryService } from './food-newsletter-delivery.service';

@Injectable()
export class FoodNewsletterPlannerService {
  private readonly logger = new Logger(FoodNewsletterPlannerService.name);

  constructor(
    @InjectModel(FoodNewsletterCandidateModel.name)
    private readonly candidateModel: Model<FoodNewsletterCandidateModel>,
    @InjectModel(FoodNewsletterScheduleModel.name)
    private readonly scheduleModel: Model<FoodNewsletterScheduleModel>,
    @InjectModel(UserModel.name)
    private readonly userModel: Model<UserModel>,
    private readonly automationSettings: NewsletterAutomationSettingsService,
    private readonly copyService: FoodNewsletterCopyService,
    private readonly deliveryService: FoodNewsletterDeliveryService,
    private readonly performances: EngagementPerformancesService,
  ) {}

  private parseHm(value: string): { h: number; m: number } {
    const [h, m] = value.split(':').map((x) => Number(x));
    return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
  }

  private isInSendWindow(now: Date, start: string, end: string): boolean {
    const { h: sh, m: sm } = this.parseHm(start);
    const { h: eh, m: em } = this.parseHm(end);
    const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const s = sh * 60 + sm;
    const e = eh * 60 + em;
    if (s === e) return true;
    if (s < e) return minutes >= s && minutes <= e;
    return minutes >= s || minutes <= e;
  }

  async runPlannerPass(): Promise<{ planned: number; delivered: number; skipped: number }> {
    const settings = await this.automationSettings.getRuntimeSettings();
    if (!this.automationSettings.isGloballyEnabled(settings)) {
      return { planned: 0, delivered: 0, skipped: 0 };
    }

    const now = new Date();
    if (!this.isInSendWindow(now, settings.sendWindowStart, settings.sendWindowEnd)) {
      return { planned: 0, delivered: 0, skipped: 0 };
    }

    let planned = 0;
    let delivered = 0;
    let skipped = 0;

    const userIds = await this.candidateModel.distinct('userId', {
      expiresAt: { $gt: now },
      score: { $gte: settings.minScore },
    });

    for (const userId of userIds) {
      const uid = String(userId);
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const gapMs = settings.minGapDays * 24 * 60 * 60 * 1000;

      const [sentWeek, sentMonth, lastSent] = await Promise.all([
        this.scheduleModel.countDocuments({
          userId,
          status: FoodNewsletterScheduleStatus.SENT,
          sentAt: { $gte: weekAgo },
        }),
        this.scheduleModel.countDocuments({
          userId,
          status: FoodNewsletterScheduleStatus.SENT,
          sentAt: { $gte: monthAgo },
        }),
        this.scheduleModel
          .findOne({ userId, status: FoodNewsletterScheduleStatus.SENT })
          .sort({ sentAt: -1 })
          .select('sentAt')
          .lean()
          .exec(),
      ]);

      const skip = async (reason: string) => {
        skipped += 1;
        await this.performances.recordEvent({
          channel: EngagementPerformanceChannel.EMAIL_NEWSLETTER,
          event: EngagementPerformanceEventType.SKIPPED,
          userId: uid,
          skipReason: reason,
        });
      };

      if (sentWeek >= settings.maxWeekly) {
        await skip('cap_weekly');
        continue;
      }
      if (sentMonth >= settings.maxMonthly) {
        await skip('cap_monthly');
        continue;
      }
      if (lastSent?.sentAt && now.getTime() - new Date(lastSent.sentAt).getTime() < gapMs) {
        await skip('min_gap');
        continue;
      }

      const candidate = await this.candidateModel
        .findOne({ userId, expiresAt: { $gt: now } })
        .sort({ score: -1 })
        .exec();
      if (!candidate) continue;

      const snapshot = candidate.contentSnapshot ?? {};
      const stores = (snapshot.stores as unknown[]) ?? [];
      const items = (snapshot.items as unknown[]) ?? [];
      if (stores.length < 1 && items.length < 2) {
        await skip('insufficient_content');
        continue;
      }

      const user = await this.userModel
        .findById(userId)
        .select('email firstName')
        .lean()
        .exec();
      const email = String(user?.email ?? '').trim();
      if (!email) {
        await skip('no_email');
        continue;
      }

      const locale = candidate.locale?.startsWith('en') ? 'en' : 'fr';
      const copy = await this.copyService.generateCopy({
        settings,
        campaignType: candidate.campaignType,
        contentSnapshot: snapshot as Record<string, unknown>,
        firstName: user?.firstName,
        locale,
      });

      const schedule = await this.scheduleModel.create({
        userId,
        email,
        candidateId: candidate._id,
        campaignType: candidate.campaignType,
        scheduledAt: now,
        status: FoodNewsletterScheduleStatus.PENDING,
        contentSnapshot: snapshot,
        copy,
        campaignId: `wise_eat_newsletter_${String(candidate._id)}`,
      });
      planned += 1;

      try {
        await this.deliveryService.deliverSchedule(schedule, candidate);
        delivered += 1;
      } catch (err) {
        await this.scheduleModel.updateOne(
          { _id: schedule._id },
          {
            $set: {
              status: FoodNewsletterScheduleStatus.FAILED,
              skipReason: err instanceof Error ? err.message : 'delivery_failed',
            },
          },
        );
        this.logger.warn(
          `newsletter delivery failed ${uid}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return { planned, delivered, skipped };
  }
}
