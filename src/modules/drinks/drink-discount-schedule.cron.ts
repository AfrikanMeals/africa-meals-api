import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { DrinkDiscountScheduleService } from '@modules/drinks/drink-discount-schedule.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

/**
 * Applique / restaure priceCad + discountPrice selon `discountSchedules`.
 *
 * `DRINK_DISCOUNT_SCHEDULE_CRON` — défaut toutes les 5 min (`0/5 * * * *`).
 * `DISABLE_DRINK_DISCOUNT_SCHEDULE_CRON=true` — désactive le job.
 */
@Injectable()
export class DrinkDiscountScheduleCron {
  private readonly logger = new Logger(DrinkDiscountScheduleCron.name);

  constructor(
    private readonly schedules: DrinkDiscountScheduleService,
    private readonly cronMonitor: CronMonitorService,
  ) {}

  @Cron(process.env.DRINK_DISCOUNT_SCHEDULE_CRON ?? '0/5 * * * *')
  async runScheduled(): Promise<void> {
    if (process.env.DISABLE_DRINK_DISCOUNT_SCHEDULE_CRON === 'true') {
      return;
    }
    await this.cronMonitor.execute('drink_discount_schedule', async () => {
      try {
        const result = await this.schedules.runPass();
        if (result.updated > 0) {
          this.logger.log(
            `Drink discount schedules: ${result.updated}/${result.scanned} boisson(s) mise(s) à jour.`,
          );
        }
      } catch (e) {
        this.logger.error(
          `Drink discount schedule cron failed: ${
            e instanceof Error ? e.stack ?? e.message : String(e)
          }`,
        );
        throw e;
      }
    });
  }
}
