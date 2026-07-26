import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PartnerSubscriptionTrialReminderService } from './partner-subscription-trial-reminder.service';

@Injectable()
export class PartnerSubscriptionTrialReminderCron {
  private readonly logger = new Logger(
    PartnerSubscriptionTrialReminderCron.name,
  );

  constructor(
    private readonly reminders: PartnerSubscriptionTrialReminderService,
    private readonly cronMonitor: CronMonitorService,
  ) {}

  @Cron(
    process.env.PARTNER_SUBSCRIPTION_TRIAL_REMINDER_CRON ??
      process.env.SUBSCRIPTION_TRIAL_REMINDER_CRON ??
      '0 8 * * *',
  )
  async runScheduled(): Promise<void> {
    if (process.env.DISABLE_PARTNER_SUBSCRIPTION_TRIAL_REMINDER_CRON === 'true') {
      return;
    }
    await this.cronMonitor.execute(
      'partner_subscription_trial_reminder',
      async () => {
        try {
          await this.reminders.runPass();
        } catch (e) {
          this.logger.error(
            `Partner subscription trial reminder cron failed: ${
              e instanceof Error ? e.stack ?? e.message : String(e)
            }`,
          );
          throw e;
        }
      },
    );
  }
}
