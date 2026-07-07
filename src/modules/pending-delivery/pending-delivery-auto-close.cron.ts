import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PendingDeliveryService } from './pending-delivery.service';

/**
 * Clôture automatique des livraisons « client absent » sans confirmation client.
 *
 * `PENDING_DELIVERY_AUTO_CLOSE_CRON` — défaut tous les jours à 6h.
 * `DISABLE_PENDING_DELIVERY_AUTO_CLOSE_CRON=true` — désactive le job.
 * `PENDING_DELIVERY_AUTO_CLOSE_DAYS` — délai en jours (défaut 7).
 */
@Injectable()
export class PendingDeliveryAutoCloseCron {
  private readonly logger = new Logger(PendingDeliveryAutoCloseCron.name);

  constructor(
    private readonly pendingDelivery: PendingDeliveryService,
    private readonly cronMonitor: CronMonitorService,
  ) {}

  @Cron(process.env.PENDING_DELIVERY_AUTO_CLOSE_CRON ?? '0 6 * * *')
  async runScheduledAutoClose(): Promise<void> {
    await this.cronMonitor.execute('pending_delivery_auto_close', async () => {
      try {
        const res = await this.pendingDelivery.runAutoClosePass();
        if (res.scanned > 0) {
          this.logger.log(
            `Pending delivery auto-close: scanned=${res.scanned} closed=${res.closed} failed=${res.failed}`,
          );
        }
        return `scanned=${res.scanned} closed=${res.closed} failed=${res.failed}`;
      } catch (e) {
        this.logger.error(
          `Pending delivery auto-close failed: ${
            e instanceof Error ? e.stack ?? e.message : String(e)
          }`,
        );
        throw e;
      }
    });
  }
}
