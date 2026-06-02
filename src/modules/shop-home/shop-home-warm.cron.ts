import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ShopHomeService } from './shop-home.service';

/**
 * Tâche planifiée : maintient le cache « accueil » chaud pour les visiteurs anonymes
 * (pas de file Redis : suffisant pour réduire les pics Mongo après expiration TTL).
 */
@Injectable()
export class ShopHomeWarmCron {
  private readonly _logger = new Logger(ShopHomeWarmCron.name);

  constructor(
    private readonly _shopHome: ShopHomeService,
    private readonly cronMonitor: CronMonitorService,
  ) {}

  @Cron(process.env.SHOP_HOME_WARM_CRON ?? '*/8 * * * *')
  async warmShopHome(): Promise<void> {
    await this.cronMonitor.execute('shop_home_warm', async () => {
      await this._shopHome.warmAnonymousCache(
        Number(process.env.SHOP_HOME_WARM_PRODUCTS_TAKE) || 48,
      );
      this._logger.debug('shop home warm cache ok');
    });
  }
}
