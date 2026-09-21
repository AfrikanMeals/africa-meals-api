import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { VendorOrderAlertService } from './vendor-order-alert.service';

/**
 * Rappels FCM call-like tant que le vendeur n’a pas Accept/Reject.
 * Défaut : toutes les 45 s. `DISABLE_VENDOR_ORDER_ALERT_CRON=true` pour couper.
 */
@Injectable()
export class VendorOrderAlertCron {
  private readonly logger = new Logger(VendorOrderAlertCron.name);

  constructor(private readonly alerts: VendorOrderAlertService) {}

  @Cron(process.env.VENDOR_ORDER_ALERT_CRON ?? '*/45 * * * * *')
  async runRemindPass(): Promise<void> {
    if (process.env.DISABLE_VENDOR_ORDER_ALERT_CRON === 'true') return;
    try {
      const res = await this.alerts.processReminderPass();
      if (res.reminded > 0) {
        this.logger.log(
          `vendor-order-alert remind: scanned=${res.scanned} reminded=${res.reminded}`,
        );
      }
    } catch (e) {
      this.logger.error(
        `vendor-order-alert remind failed: ${
          e instanceof Error ? e.stack ?? e.message : String(e)
        }`,
      );
    }
  }
}
