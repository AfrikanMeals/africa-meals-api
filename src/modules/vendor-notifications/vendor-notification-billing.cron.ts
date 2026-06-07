import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { VendorNotificationBillingService } from './vendor-notification-billing.service';
import { VendorNotificationStripeBillingService } from './vendor-notification-stripe-billing.service';
import { previousBillingMonthKey } from './vendor-notification-dispatch.service';

@Injectable()
export class VendorNotificationBillingCron {
  private readonly logger = new Logger(VendorNotificationBillingCron.name);

  constructor(
    private readonly billing: VendorNotificationBillingService,
    private readonly stripeBilling: VendorNotificationStripeBillingService,
    private readonly cronMonitor: CronMonitorService,
  ) {}

  /** Clôture mensuelle + facture Stripe (1er du mois, 04:15 UTC). */
  @Cron(process.env.VENDOR_NOTIFICATION_BILLING_CRON ?? '15 4 1 * *')
  async closePreviousMonthCharges(): Promise<void> {
    const job = 'vendor-notification-monthly-billing';
    await this.cronMonitor.execute(job, async () => {
      const billingMonth = previousBillingMonthKey();
      const result =
        await this.billing.closeMonthlyChargesForMonth(billingMonth);
      const issued =
        await this.stripeBilling.issueStripeInvoicesForMonth(billingMonth);
      this.logger.log(
        `Closed vendor SMS billing ${result.billingMonth} (${result.stores} stores), Stripe issued=${issued.issued}`,
      );
    });
  }

  /** Suspend SMS si facture impayée après la période de grâce (quotidien 05:00 UTC). */
  @Cron(process.env.VENDOR_SMS_BILLING_OVERDUE_CRON ?? '0 5 * * *')
  async suspendOverdueSmsBilling(): Promise<void> {
    const job = 'vendor-sms-billing-overdue';
    await this.cronMonitor.execute(job, async () => {
      const result = await this.stripeBilling.processOverdueCharges();
      if (result.suspended > 0) {
        this.logger.warn(
          `SMS billing overdue: ${result.suspended} store(s) suspended`,
        );
      }
    });
  }
}
