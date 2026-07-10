import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DeliveryAgentPayoutSettleService } from './delivery-agent-payout-settle.service';

/**
 * Relance transfers Connect livreur + versements DIAMOND en attente de solde.
 *
 * `DELIVERY_AGENT_PAYOUT_SETTLE_CRON` — défaut toutes les 15 min.
 * `DISABLE_DELIVERY_AGENT_PAYOUT_SETTLE_CRON=true` — désactive le job.
 */
@Injectable()
export class DeliveryAgentPayoutSettleCron {
  private readonly logger = new Logger(DeliveryAgentPayoutSettleCron.name);

  constructor(
    private readonly settle: DeliveryAgentPayoutSettleService,
    private readonly cronMonitor: CronMonitorService,
  ) {}

  @Cron(process.env.DELIVERY_AGENT_PAYOUT_SETTLE_CRON ?? '*/15 * * * *')
  async runScheduledSettle(): Promise<void> {
    await this.cronMonitor.execute(
      'delivery_agent_payout_settle',
      async () => {
        try {
          const res = await this.settle.runPass();
          if (
            res.transfersScanned > 0 ||
            res.diamondScanned > 0 ||
            res.transfersSucceeded > 0 ||
            res.diamondSettled > 0
          ) {
            this.logger.log(
              `Delivery payout settle: transfers=${res.transfersSucceeded}/${res.transfersScanned} diamond=${res.diamondSettled}/${res.diamondScanned}`,
            );
          }
        } catch (e) {
          this.logger.error(
            `Delivery payout settle failed: ${
              e instanceof Error ? e.stack ?? e.message : String(e)
            }`,
          );
          throw e;
        }
      },
    );
  }
}
