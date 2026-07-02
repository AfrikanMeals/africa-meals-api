import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { EngagementPerformancesService } from '@modules/engagement-performances/engagement-performances.service';
import {
  EngagementPerformanceChannel,
  EngagementPerformanceEventType,
} from '@schemas/engagement-performance-event.schema';
import {
  FoodNewsletterScheduleModel,
  FoodNewsletterScheduleStatus,
} from '@schemas/food-newsletter-schedule.schema';
import { UserNotificationPreferencesService } from '@modules/user-notification-preferences/user-notification-preferences.service';
import { Model } from 'mongoose';
import {
  verifyFoodNewsletterToken,
  resolveFoodNewsletterSigningSecret,
} from './food-newsletter-track-token.util';

@Injectable()
export class FoodNewsletterTrackingService {
  constructor(
    @InjectModel(FoodNewsletterScheduleModel.name)
    private readonly scheduleModel: Model<FoodNewsletterScheduleModel>,
    private readonly performances: EngagementPerformancesService,
    private readonly userPrefs: UserNotificationPreferencesService,
    private readonly config: ConfigService,
  ) {}

  private verifyScheduleToken(scheduleId: string, token?: string): boolean {
    const secret = resolveFoodNewsletterSigningSecret(this.config);
    return verifyFoodNewsletterToken(scheduleId, token, secret);
  }

  async recordOpen(scheduleId: string, token?: string): Promise<boolean> {
    if (!this.verifyScheduleToken(scheduleId, token)) return false;
    const schedule = await this.scheduleModel.findById(scheduleId).exec();
    if (!schedule || schedule.status !== FoodNewsletterScheduleStatus.SENT) {
      return false;
    }
    if (!schedule.openedAt) {
      await this.scheduleModel.updateOne(
        { _id: schedule._id },
        { $set: { openedAt: new Date() } },
      );
      await this.userPrefs.recordOpen(String(schedule.userId));
    }
    await this.performances.recordEvent({
      channel: EngagementPerformanceChannel.EMAIL_NEWSLETTER,
      event: EngagementPerformanceEventType.OPEN,
      userId: String(schedule.userId),
      scheduleId,
      campaignId: schedule.campaignId,
      candidateType: schedule.campaignType,
    });
    return true;
  }

  async recordClick(scheduleId: string, token?: string): Promise<string | null> {
    if (!this.verifyScheduleToken(scheduleId, token)) return null;
    const schedule = await this.scheduleModel.findById(scheduleId).exec();
    if (!schedule || schedule.status !== FoodNewsletterScheduleStatus.SENT) {
      return null;
    }
    if (!schedule.clickedAt) {
      await this.scheduleModel.updateOne(
        { _id: schedule._id },
        { $set: { clickedAt: new Date() } },
      );
    }
    await this.performances.recordEvent({
      channel: EngagementPerformanceChannel.EMAIL_NEWSLETTER,
      event: EngagementPerformanceEventType.CLICK,
      userId: String(schedule.userId),
      scheduleId,
      campaignId: schedule.campaignId,
      candidateType: schedule.campaignType,
    });
    const web =
      this.config.get<string>('PUBLIC_WEB_URL')?.trim() ||
      'https://wise-eat.com';
    return `${web.replace(/\/$/, '')}/?utm_source=wise_eat_newsletter&utm_campaign=${scheduleId}`;
  }

  async unsubscribe(scheduleId: string, token?: string): Promise<boolean> {
    if (!this.verifyScheduleToken(scheduleId, token)) return false;
    const schedule = await this.scheduleModel.findById(scheduleId).exec();
    if (!schedule) return false;
    await this.userPrefs.unsubscribeByToken(String(schedule.userId));
    await this.performances.recordEvent({
      channel: EngagementPerformanceChannel.EMAIL_NEWSLETTER,
      event: EngagementPerformanceEventType.UNSUBSCRIBE,
      userId: String(schedule.userId),
      scheduleId,
      campaignId: schedule.campaignId,
    });
    return true;
  }
}
