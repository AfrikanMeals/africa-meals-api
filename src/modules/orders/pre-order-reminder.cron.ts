import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PreOrderReminderService } from './pre-order-reminder.service';

@Injectable()
export class PreOrderReminderCron {
  private readonly _logger = new Logger(PreOrderReminderCron.name);

  constructor(private readonly _reminders: PreOrderReminderService) {}

  /** Tous les jours à 9 h UTC — rappels J-3, J-2, J-1 et jour J. */
  @Cron(CronExpression.EVERY_DAY_AT_9AM)
  async runScheduledPreOrderReminders(): Promise<void> {
    try {
      const res = await this._reminders.runReminderPass();
      if (
        res.customerNotified > 0 ||
        res.vendorNotified > 0 ||
        res.promoted > 0
      ) {
        this._logger.log(
          `Pre-order reminders: scanned=${res.scanned} customer=${res.customerNotified} vendor=${res.vendorNotified} promoted=${res.promoted} skipped=${res.skipped}`,
        );
      }
    } catch (err) {
      this._logger.error(
        `Pre-order reminder cron failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
