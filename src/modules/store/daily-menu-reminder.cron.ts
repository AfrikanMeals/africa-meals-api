import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DailyMenuReminderService } from './daily-menu-reminder.service';

/**
 * Rappel FCM aux vendeurs actifs sans menu du jour pour le jour courant (fuseau configurable).
 *
 * `DAILY_MENU_REMINDER_CRON` — défaut 9h00 chaque jour (`0 9 * * *`, heure serveur).
 * `DAILY_MENU_REMINDER_TZ` — jour évalué (défaut `America/Montreal`).
 * `DISABLE_DAILY_MENU_REMINDER_CRON=true` — désactive le job.
 */
@Injectable()
export class DailyMenuReminderCron {
  private readonly _logger = new Logger(DailyMenuReminderCron.name);

  constructor(private readonly _reminders: DailyMenuReminderService) {}

  @Cron(process.env.DAILY_MENU_REMINDER_CRON ?? '0 9 * * *')
  async runScheduledDailyMenuReminders(): Promise<void> {
    if (process.env.DISABLE_DAILY_MENU_REMINDER_CRON === 'true') {
      return;
    }
    try {
      const res = await this._reminders.runReminderPass();
      if (res.notified > 0 || res.scanned > 0) {
        this._logger.log(
          `Daily menu reminder: scanned=${res.scanned} notified=${res.notified} ` +
            `hasMenu=${res.skippedHasMenu} alreadySent=${res.skippedAlreadySent} ` +
            `noOwner=${res.skippedNoOwner}`,
        );
      }
    } catch (e) {
      this._logger.error(
        `Daily menu reminder cron failed: ${
          e instanceof Error ? e.stack ?? e.message : String(e)
        }`,
      );
    }
  }
}
