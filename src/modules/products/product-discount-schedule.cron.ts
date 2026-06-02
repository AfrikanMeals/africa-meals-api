import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { ProductDiscountScheduleService } from '@modules/products/product-discount-schedule.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

/**
 * Applique / restaure prix et promos selon les fenêtres `discountSchedules`.
 *
 * `PRODUCT_DISCOUNT_SCHEDULE_CRON` — défaut toutes les 5 min (`0/5 * * * *`).
 * `DISABLE_PRODUCT_DISCOUNT_SCHEDULE_CRON=true` — désactive le job.
 */
@Injectable()
export class ProductDiscountScheduleCron {
  private readonly logger = new Logger(ProductDiscountScheduleCron.name);

  constructor(
    private readonly schedules: ProductDiscountScheduleService,
    private readonly cronMonitor: CronMonitorService,
  ) {}

  @Cron(process.env.PRODUCT_DISCOUNT_SCHEDULE_CRON ?? '0/5 * * * *')
  async runScheduled(): Promise<void> {
    await this.cronMonitor.execute('product_discount_schedule', async () => {
      try {
        const result = await this.schedules.runPass();
        if (result.updated > 0) {
          this.logger.log(
            `Product discount schedules: ${result.updated}/${result.scanned} produit(s) mis à jour.`,
          );
        }
      } catch (e) {
        this.logger.error(
          `Product discount schedule cron failed: ${
            e instanceof Error ? e.stack ?? e.message : String(e)
          }`,
        );
        throw e;
      }
    });
  }
}
