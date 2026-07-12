import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DeliveryOrderOfferService } from './delivery-order-offer.service';

/**
 * Expire les offres course flotte boutique (`DELIVERY_ORDER_OFFER_TIMEOUT_SEC`).
 *
 * Défaut : toutes les 15 s.
 * `DISABLE_DELIVERY_ORDER_OFFER_CRON=true` — désactive.
 */
@Injectable()
export class DeliveryOrderOfferCron {
  private readonly logger = new Logger(DeliveryOrderOfferCron.name);

  constructor(
    private readonly offers: DeliveryOrderOfferService,
    private readonly cronMonitor: CronMonitorService,
  ) {}

  @Cron(process.env.DELIVERY_ORDER_OFFER_CRON ?? '*/15 * * * * *')
  async runExpirePass(): Promise<void> {
    if (process.env.DISABLE_DELIVERY_ORDER_OFFER_CRON === 'true') return;
    await this.cronMonitor.execute('delivery_order_offer_expire', async () => {
      try {
        const res = await this.offers.processExpiredOffers();
        if (res.expired > 0) {
          this.logger.log(
            `delivery-order-offer expire: expired=${res.expired}`,
          );
        }
      } catch (e) {
        this.logger.error(
          `delivery-order-offer expire failed: ${
            e instanceof Error ? e.stack ?? e.message : String(e)
          }`,
        );
        throw e;
      }
    });
  }
}
