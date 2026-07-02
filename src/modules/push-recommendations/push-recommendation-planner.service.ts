import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { RecommendationAutomationSettingsService } from '@modules/recommendation-automation-settings/recommendation-automation-settings.service';
import { EngagementPerformancesService } from '@modules/engagement-performances/engagement-performances.service';
import {
  EngagementPerformanceChannel,
  EngagementPerformanceEventType,
} from '@schemas/engagement-performance-event.schema';
import {
  PushRecommendationCandidateModel,
} from '@schemas/push-recommendation-candidate.schema';
import {
  PushDeliveryScheduleModel,
  PushDeliveryScheduleStatus,
} from '@schemas/push-delivery-schedule.schema';
import { Model, Types } from 'mongoose';
import { PushRecommendationCopyService } from './push-recommendation-copy.service';
import { PushRecommendationDeliveryService } from './push-recommendation-delivery.service';

@Injectable()
export class PushRecommendationPlannerService {
  private readonly logger = new Logger(PushRecommendationPlannerService.name);

  constructor(
    @InjectModel(PushRecommendationCandidateModel.name)
    private readonly candidateModel: Model<PushRecommendationCandidateModel>,
    @InjectModel(PushDeliveryScheduleModel.name)
    private readonly scheduleModel: Model<PushDeliveryScheduleModel>,
    private readonly automationSettings: RecommendationAutomationSettingsService,
    private readonly copyService: PushRecommendationCopyService,
    private readonly deliveryService: PushRecommendationDeliveryService,
    private readonly performances: EngagementPerformancesService,
  ) {}

  private parseHm(value: string): { h: number; m: number } {
    const [h, m] = value.split(':').map((x) => Number(x));
    return {
      h: Number.isFinite(h) ? h : 0,
      m: Number.isFinite(m) ? m : 0,
    };
  }

  private isQuietHours(now: Date, quietStart: string, quietEnd: string): boolean {
    const { h: sh, m: sm } = this.parseHm(quietStart);
    const { h: eh, m: em } = this.parseHm(quietEnd);
    const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    if (start === end) return false;
    if (start < end) return minutes >= start && minutes < end;
    return minutes >= start || minutes < end;
  }

  async runPlannerPass(): Promise<{ planned: number; delivered: number; skipped: number }> {
    const settings = await this.automationSettings.getRuntimeSettings();
    if (!this.automationSettings.isGloballyEnabled(settings)) {
      return { planned: 0, delivered: 0, skipped: 0 };
    }

    const now = new Date();
    let planned = 0;
    let delivered = 0;
    let skipped = 0;

    const userIds = await this.candidateModel.distinct('userId', {
      expiresAt: { $gt: now },
      score: { $gte: settings.minScore },
    });

    for (const userId of userIds) {
      const uid = String(userId);
      if (this.isQuietHours(now, settings.quietStart, settings.quietEnd)) {
        skipped += 1;
        await this.performances.recordEvent({
          channel: EngagementPerformanceChannel.PUSH_RECO,
          event: EngagementPerformanceEventType.SKIPPED,
          userId: uid,
          skipReason: 'quiet_hours',
        });
        continue;
      }

      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const [sentDay, sentWeek, lastSent] = await Promise.all([
        this.scheduleModel.countDocuments({
          userId,
          status: PushDeliveryScheduleStatus.SENT,
          sentAt: { $gte: dayAgo },
        }),
        this.scheduleModel.countDocuments({
          userId,
          status: PushDeliveryScheduleStatus.SENT,
          sentAt: { $gte: weekAgo },
        }),
        this.scheduleModel
          .findOne({ userId, status: PushDeliveryScheduleStatus.SENT })
          .sort({ sentAt: -1 })
          .select('sentAt')
          .lean()
          .exec(),
      ]);

      if (sentDay >= settings.maxDaily) {
        skipped += 1;
        await this.performances.recordEvent({
          channel: EngagementPerformanceChannel.PUSH_RECO,
          event: EngagementPerformanceEventType.SKIPPED,
          userId: uid,
          skipReason: 'cap_daily',
        });
        continue;
      }
      if (sentWeek >= settings.maxWeekly) {
        skipped += 1;
        await this.performances.recordEvent({
          channel: EngagementPerformanceChannel.PUSH_RECO,
          event: EngagementPerformanceEventType.SKIPPED,
          userId: uid,
          skipReason: 'cap_weekly',
        });
        continue;
      }
      if (
        lastSent?.sentAt &&
        now.getTime() - new Date(lastSent.sentAt).getTime() <
          settings.minGapHours * 60 * 60 * 1000
      ) {
        skipped += 1;
        await this.performances.recordEvent({
          channel: EngagementPerformanceChannel.PUSH_RECO,
          event: EngagementPerformanceEventType.SKIPPED,
          userId: uid,
          skipReason: 'min_gap',
        });
        continue;
      }

      const candidate = await this.candidateModel
        .findOne({ userId, expiresAt: { $gt: now } })
        .sort({ score: -1 })
        .exec();
      if (!candidate) continue;

      const copy = await this.copyService.generateCopy({
        settings,
        candidateType: candidate.candidateType,
        contextSnapshot: candidate.contextSnapshot ?? {},
      });

      const schedule = await this.scheduleModel.create({
        userId,
        candidateId: candidate._id,
        scheduledAt: now,
        status: PushDeliveryScheduleStatus.PENDING,
        copy,
        candidateType: candidate.candidateType,
        campaignId: `wise_eat_push_reco_${String(candidate._id)}`,
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
              status: PushDeliveryScheduleStatus.FAILED,
              skipReason: err instanceof Error ? err.message : 'delivery_failed',
            },
          },
        );
        this.logger.warn(
          `delivery failed user ${uid}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return { planned, delivered, skipped };
  }
}
