import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DatabaseSettingsService } from './database-settings.service';

/**
 * Planifie sauvegardes incrémentales et complètes selon `database_settings`.
 *
 * `DATABASE_BACKUP_CRON` — défaut toutes les heures (`0 * * * *`).
 * `DISABLE_DATABASE_BACKUP_CRON=true` — désactive le job.
 */
@Injectable()
export class DatabaseBackupCron {
  private readonly logger = new Logger(DatabaseBackupCron.name);

  constructor(
    private readonly settings: DatabaseSettingsService,
    private readonly cronMonitor: CronMonitorService,
  ) {}

  @Cron(process.env.DATABASE_BACKUP_CRON ?? '0 * * * *')
  async runScheduled(): Promise<void> {
    if (process.env.DISABLE_DATABASE_BACKUP_CRON === 'true') {
      return;
    }
    await this.cronMonitor.execute('database_backup_scheduler', async () => {
      try {
        await this.settings.runScheduledBackups();
      } catch (e) {
        this.logger.error(
          `Database backup cron failed: ${
            e instanceof Error ? e.stack ?? e.message : String(e)
          }`,
        );
        throw e;
      }
    });
  }
}
