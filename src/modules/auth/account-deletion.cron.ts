import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AuthService } from './auth.service';

/**
 * Suppression définitive des comptes marqués en attente de suppression.
 *
 * `ACCOUNT_DELETION_CRON` — défaut : toutes les heures (`0 * * * *`).
 * `DISABLE_ACCOUNT_DELETION_CRON=true` — désactive le job.
 */
@Injectable()
export class AccountDeletionCron {
  private readonly _logger = new Logger(AccountDeletionCron.name);

  constructor(
    private readonly _auth: AuthService,
    private readonly cronMonitor: CronMonitorService,
  ) {}

  @Cron(process.env.ACCOUNT_DELETION_CRON ?? '0 * * * *')
  async runScheduledDeletion(): Promise<void> {
    await this.cronMonitor.execute('account_deletion', async () => {
      try {
        const res = await this._auth.runScheduledAccountDeletionPass();
        if (res.scanned > 0 || res.deleted > 0) {
          this._logger.log(
            `Account deletion cron: scanned=${res.scanned} deleted=${res.deleted}`,
          );
        }
      } catch (e) {
        this._logger.error(
          `Account deletion cron failed: ${
            e instanceof Error ? e.stack ?? e.message : String(e)
          }`,
        );
        throw e;
      }
    });
  }
}
