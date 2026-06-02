import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AdNotificationService } from './ad-notification.service';

/**
 * Worker d’envoi des notifications publicitaires (add-on Email / Push / In-App / SMS).
 *
 * `AD_NOTIFICATION_DISPATCH_CRON` — défaut toutes les 3 minutes.
 * `DISABLE_AD_NOTIFICATION_DISPATCH_CRON=true` — désactive le job.
 */
@Injectable()
export class AdNotificationDispatchCron {
  private readonly _logger = new Logger(AdNotificationDispatchCron.name);

  constructor(
    private readonly _adNotifications: AdNotificationService,
    private readonly cronMonitor: CronMonitorService,
  ) {}

  @Cron(process.env.AD_NOTIFICATION_DISPATCH_CRON ?? '*/3 * * * *')
  async runScheduledDispatch(): Promise<void> {
    await this.cronMonitor.execute('ad_notification_dispatch', async () => {
      try {
        const res = await this._adNotifications.runDispatchPass();
        if (res.bannersDispatched > 0 || res.campaignsDispatched > 0) {
          this._logger.log(
            `Ad notification dispatch: banners=${res.bannersDispatched} campaigns=${res.campaignsDispatched}`,
          );
        }
      } catch (e) {
        this._logger.error(
          `Ad notification dispatch cron failed: ${
            e instanceof Error ? e.stack ?? e.message : String(e)
          }`,
        );
        throw e;
      }
    });
  }
}
