import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SubscriptionTrialReminderService } from './subscription-trial-reminder.service';

/**
 * Rappels fin d’essai abonnement vendeur + expiration automatique.
 *
 * `SUBSCRIPTION_TRIAL_REMINDER_CRON` — défaut 8h00 (`0 8 * * *`).
 * `DISABLE_SUBSCRIPTION_TRIAL_REMINDER_CRON=true` — désactive le job.
 */
@Injectable()
export class SubscriptionTrialReminderCron {
  private readonly logger = new Logger(SubscriptionTrialReminderCron.name);

  constructor(private readonly reminders: SubscriptionTrialReminderService) {}

  @Cron(process.env.SUBSCRIPTION_TRIAL_REMINDER_CRON ?? '0 8 * * *')
  async runScheduled(): Promise<void> {
    if (process.env.DISABLE_SUBSCRIPTION_TRIAL_REMINDER_CRON === 'true') {
      return;
    }
    try {
      await this.reminders.runPass();
    } catch (e) {
      this.logger.error(
        `Subscription trial reminder cron failed: ${
          e instanceof Error ? e.stack ?? e.message : String(e)
        }`,
      );
    }
  }
}
