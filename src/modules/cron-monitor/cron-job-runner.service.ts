import { BadRequestException, Injectable } from '@nestjs/common';
import { AdminOpsReportsService } from '@modules/admin-ops-reports/admin-ops-reports.service';
import { AdNotificationService } from '@modules/ads/ad-notification.service';
import { AdsTargetingService } from '@modules/ads-targeting/ads-targeting.service';
import { AuthService } from '@modules/auth/auth.service';
import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { getCronJobDefinition } from '@modules/cron-monitor/cron-jobs.registry';
import { DailyMenuReminderService } from '@modules/store/daily-menu-reminder.service';
import { ProductDiscountScheduleService } from '@modules/products/product-discount-schedule.service';
import { RecommendationTrainingService } from '@modules/recommendations/recommendation-training.service';
import { RefundProcessingService } from '@modules/refunds/refund-processing.service';
import {
  SearchVectorReindexService,
} from '@modules/search-settings/search-settings.service';
import { ShopHomeService } from '@modules/shop-home/shop-home.service';
import { SubscriptionTrialReminderService } from '@modules/subscriptions/subscription-trial-reminder.service';
import { SubscriptionsService } from '@modules/subscriptions/subscriptions.service';
import { UserModel } from '@schemas/user.schema';
import { ModuleRef } from '@nestjs/core';

@Injectable()
export class CronJobRunnerService {
  constructor(
    private readonly cronMonitor: CronMonitorService,
    private readonly moduleRef: ModuleRef,
  ) {}

  private resolve<T>(token: new (...args: never[]) => T): T {
    const instance = this.moduleRef.get(token, { strict: false });
    if (!instance) {
      throw new BadRequestException(`cron_runner_service_unavailable:${token.name}`);
    }
    return instance;
  }

  private resolveRunner(key: string): () => Promise<void | string> {
    switch (key) {
      case 'admin_ops_report':
        return async () => {
          const res = await this.resolve(AdminOpsReportsService).runScheduledPass();
          return `sent=${res.sent} skipped=${res.skipped} failed=${res.failed}`;
        };
      case 'ad_notification_dispatch':
        return async () => {
          const res = await this.resolve(AdNotificationService).runDispatchPass();
          return `banners=${res.bannersDispatched} campaigns=${res.campaignsDispatched}`;
        };
      case 'subscription_lifecycle':
        return async () => {
          await this.resolve(SubscriptionsService).reconcileSubscriptionLifecycle();
        };
      case 'subscription_trial_reminder':
        return async () => {
          await this.resolve(SubscriptionTrialReminderService).runPass();
        };
      case 'refund_processing':
        return async () => {
          const res =
            await this.resolve(RefundProcessingService).runScheduledProcessingPass();
          return `scanned=${res.scanned} processed=${res.processed} failed=${res.failed}`;
        };
      case 'daily_menu_reminder':
        return async () => {
          const res = await this.resolve(DailyMenuReminderService).runReminderPass();
          return `scanned=${res.scanned} notified=${res.notified}`;
        };
      case 'account_deletion':
        return async () => {
          const res = await this.resolve(AuthService).runScheduledAccountDeletionPass();
          return `scanned=${res.scanned} deleted=${res.deleted}`;
        };
      case 'search_vector_reindex':
        return async () => {
          const result = await this.resolve(SearchVectorReindexService).runReindex();
          return result.message;
        };
      case 'recommendation_training':
        return async () => {
          await this.resolve(RecommendationTrainingService).runTrainingPass();
        };
      case 'shop_home_warm':
        return async () => {
          await this.resolve(ShopHomeService).warmAnonymousCache(
            Number(process.env.SHOP_HOME_WARM_PRODUCTS_TAKE) || 48,
          );
        };
      case 'product_discount_schedule':
        return async () => {
          const result = await this.resolve(ProductDiscountScheduleService).runPass();
          return `updated=${result.updated}/${result.scanned}`;
        };
      case 'ads_targeting_retention':
        return async () => {
          const res =
            await this.resolve(AdsTargetingService).runRetentionPurgePass();
          return `events=${res.eventsDeleted} logs=${res.logsDeleted} days=${res.retentionDays}`;
        };
      default:
        throw new BadRequestException('unknown_cron_job');
    }
  }

  runJob(user: UserModel, key: string) {
    const normalized = key.trim();
    if (!getCronJobDefinition(normalized)) {
      throw new BadRequestException('unknown_cron_job');
    }
    return this.cronMonitor.runJobManually(
      user,
      normalized,
      this.resolveRunner(normalized),
    );
  }
}
