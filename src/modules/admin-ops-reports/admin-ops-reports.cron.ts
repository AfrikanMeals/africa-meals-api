import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AdminOpsReportsService } from './admin-ops-reports.service';

/**
 * Envoi automatique du rapport d'activité aux propriétaires vendeurs (e-mail + Excel).
 *
 * `ADMIN_OPS_REPORT_CRON` — défaut chaque heure à :15.
 * `DISABLE_ADMIN_OPS_REPORT_CRON=true` — désactive le job.
 */
@Injectable()
export class AdminOpsReportsCron {
  private readonly logger = new Logger(AdminOpsReportsCron.name);

  constructor(private readonly reports: AdminOpsReportsService) {}

  @Cron(process.env.ADMIN_OPS_REPORT_CRON ?? '15 * * * *')
  async runScheduled(): Promise<void> {
    if (process.env.DISABLE_ADMIN_OPS_REPORT_CRON === 'true') {
      return;
    }
    const res = await this.reports.runScheduledPass();
    if (res.sent) {
      this.logger.log(
        `Scheduled vendor ops report (${res.periodKey}): sent=${res.sent} skipped=${res.skipped} failed=${res.failed}`,
      );
    }
  }
}
