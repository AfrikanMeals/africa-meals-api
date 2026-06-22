import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SubscriptionAdCashService } from './subscription-ad-cash.service';

/**
 * Versements mensuels Ad Cash pour formules annuelles.
 *
 * `SUBSCRIPTION_AD_CASH_CRON` — défaut tous les jours à 06:00.
 * `DISABLE_SUBSCRIPTION_AD_CASH_CRON=true` — désactive le job.
 */
@Injectable()
export class SubscriptionAdCashCron {
  private readonly logger = new Logger(SubscriptionAdCashCron.name);

  constructor(
    private readonly adCash: SubscriptionAdCashService,
    private readonly cronMonitor: CronMonitorService,
  ) {}

  @Cron(process.env.SUBSCRIPTION_AD_CASH_CRON ?? '0 6 * * *')
  async runScheduled(): Promise<void> {
    if (process.env.DISABLE_SUBSCRIPTION_AD_CASH_CRON === 'true') {
      return;
    }
    await this.cronMonitor.execute('subscription_ad_cash', async () => {
      try {
        const count = await this.adCash.processDueInstallments();
        if (count > 0) {
          this.logger.log(`Ad Cash plan installments processed: ${count}`);
        }
      } catch (e) {
        this.logger.error(
          `Subscription Ad Cash cron failed: ${
            e instanceof Error ? e.stack ?? e.message : String(e)
          }`,
        );
        throw e;
      }
    });
  }
}
