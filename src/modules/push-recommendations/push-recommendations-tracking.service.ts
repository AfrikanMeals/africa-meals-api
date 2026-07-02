import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { EngagementPerformancesService } from '@modules/engagement-performances/engagement-performances.service';
import {
  EngagementPerformanceChannel,
  EngagementPerformanceEventType,
} from '@schemas/engagement-performance-event.schema';
import {
  PushDeliveryScheduleModel,
  PushDeliveryScheduleStatus,
} from '@schemas/push-delivery-schedule.schema';
import { UserModel } from '@schemas/user.schema';
import { Model } from 'mongoose';
import { TrackPushRecommendationDto } from './dto/track-push-recommendation.dto';

@Injectable()
export class PushRecommendationsTrackingService {
  constructor(
    private readonly performances: EngagementPerformancesService,
    @InjectModel(PushDeliveryScheduleModel.name)
    private readonly scheduleModel: Model<PushDeliveryScheduleModel>,
  ) {}

  async trackUserEvent(user: UserModel, body: TrackPushRecommendationDto): Promise<void> {
    const userId = String(user._id);
    await this.performances.recordEvent({
      channel: EngagementPerformanceChannel.PUSH_RECO,
      event: body.event,
      userId,
      scheduleId: body.scheduleId ?? '',
      campaignId: body.campaignId ?? '',
      candidateType: body.candidateType ?? '',
      refType: body.refType ?? '',
      refId: body.refId ?? '',
    });

    if (!body.scheduleId) return;
    const patch: Record<string, Date> = {};
    if (body.event === EngagementPerformanceEventType.OPEN) {
      patch.openedAt = new Date();
    }
    if (body.event === EngagementPerformanceEventType.CLICK) {
      patch.clickedAt = new Date();
    }
    if (body.event === EngagementPerformanceEventType.DISMISS) {
      patch.dismissedAt = new Date();
    }
    if (Object.keys(patch).length === 0) return;

    await this.scheduleModel.updateOne(
      {
        _id: body.scheduleId,
        userId: user._id,
        status: PushDeliveryScheduleStatus.SENT,
      },
      { $set: patch },
    );
  }
}
