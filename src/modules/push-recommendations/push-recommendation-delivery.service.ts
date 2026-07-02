import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { EngagementPerformancesService } from '@modules/engagement-performances/engagement-performances.service';
import {
  EngagementPerformanceChannel,
  EngagementPerformanceEventType,
} from '@schemas/engagement-performance-event.schema';
import {
  PushRecommendationCandidateDocument,
  PushRecommendationCandidateModel,
} from '@schemas/push-recommendation-candidate.schema';
import {
  PushDeliveryScheduleDocument,
  PushDeliveryScheduleModel,
  PushDeliveryScheduleStatus,
} from '@schemas/push-delivery-schedule.schema';
import { Model } from 'mongoose';

@Injectable()
export class PushRecommendationDeliveryService {
  private readonly logger = new Logger(PushRecommendationDeliveryService.name);

  constructor(
    @InjectModel(PushDeliveryScheduleModel.name)
    private readonly scheduleModel: Model<PushDeliveryScheduleDocument>,
    @InjectModel(PushRecommendationCandidateModel.name)
    private readonly candidateModel: Model<PushRecommendationCandidateDocument>,
    private readonly notifications: NotificationsService,
    private readonly performances: EngagementPerformancesService,
  ) {}

  async deliverSchedule(
    schedule: PushDeliveryScheduleDocument,
    candidate: PushRecommendationCandidateDocument,
  ): Promise<void> {
    const userId = String(schedule.userId);
    const ctx = candidate.contextSnapshot ?? {};
    const refId = String(candidate.refId);
    const storeId = String(ctx.storeId ?? '');
    const scheduleId = String(schedule._id);
    const campaignId = schedule.campaignId || `wise_eat_push_reco_${scheduleId}`;

    const title = String(schedule.copy?.title ?? 'Wise Eat');
    const body = String(schedule.copy?.body ?? 'Découvrez une recommandation pour vous');

    await this.notifications.createUserScopedNotification({
      recipientUserId: userId,
      title,
      body,
      type: 'reco_push',
      sendPush: true,
      data: {
        type: 'reco_push',
        category: 'recommendations',
        candidateType: candidate.candidateType,
        refType: candidate.refType,
        refId,
        storeId,
        cuisineTags: candidate.cuisineTags ?? [],
        deepLink: String(ctx.deepLink ?? `wise-eat://open/product/${refId}`),
        campaignId,
        scheduleId,
        imageUrl: String(ctx.imageUrl ?? ''),
      },
    });

    const sentAt = new Date();
    await this.scheduleModel.updateOne(
      { _id: schedule._id },
      {
        $set: {
          status: PushDeliveryScheduleStatus.SENT,
          sentAt,
        },
      },
    );
    await this.candidateModel.updateOne(
      { _id: candidate._id },
      { $set: { sentAt } },
    );

    await this.performances.recordEvent({
      channel: EngagementPerformanceChannel.PUSH_RECO,
      event: EngagementPerformanceEventType.SENT,
      userId,
      scheduleId,
      campaignId,
      candidateType: candidate.candidateType,
      refType: candidate.refType,
      refId,
      cuisineTags: candidate.cuisineTags,
      copySource: schedule.copy?.source ?? 'template',
    });
    await this.performances.recordEvent({
      channel: EngagementPerformanceChannel.PUSH_RECO,
      event: EngagementPerformanceEventType.DELIVERED,
      userId,
      scheduleId,
      campaignId,
      candidateType: candidate.candidateType,
    });
  }
}
