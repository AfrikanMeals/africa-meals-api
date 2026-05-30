import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RefundProcessingService } from './refund-processing.service';

/**
 * Analyse et traite les remboursements `pending` éligibles (Stripe + délai configurable).
 *
 * `REFUND_PROCESSING_CRON` — défaut toutes les 15 minutes.
 * `DISABLE_REFUND_PROCESSING_CRON=true` — désactive le job.
 */
@Injectable()
export class RefundProcessingCron {
  private readonly logger = new Logger(RefundProcessingCron.name);

  constructor(private readonly refunds: RefundProcessingService) {}

  @Cron(process.env.REFUND_PROCESSING_CRON ?? '*/15 * * * *')
  async runScheduledRefunds(): Promise<void> {
    if (process.env.DISABLE_REFUND_PROCESSING_CRON === 'true') {
      return;
    }
    try {
      const res = await this.refunds.runScheduledProcessingPass();
      if (res.scanned > 0) {
        this.logger.log(
          `Refund cron: scanned=${res.scanned} processed=${res.processed} failed=${res.failed}`,
        );
      }
    } catch (e) {
      this.logger.error(
        `Refund cron failed: ${
          e instanceof Error ? e.stack ?? e.message : String(e)
        }`,
      );
    }
  }
}
