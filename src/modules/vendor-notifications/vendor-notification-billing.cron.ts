import { CronMonitorService } from '@modules/cron-monitor/cron-monitor.service';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { VendorNotificationBillingService } from './vendor-notification-billing.service';
import { VendorNotificationStripeBillingService } from './vendor-notification-stripe-billing.service';
import { VendorNotificationDispatchService } from './vendor-notification-dispatch.service';
import {
  previousBillingPeriodKey,
  shouldClosePreviousBillingPeriod,
} from './vendor-notification-billing-period.util';

@Injectable()
export class VendorNotificationBillingCron {
  private readonly logger = new Logger(VendorNotificationBillingCron.name);

  constructor(
    private readonly billing: VendorNotificationBillingService,
    private readonly stripeBilling: VendorNotificationStripeBillingService,
    private readonly cronMonitor: CronMonitorService,
    private readonly dispatch: VendorNotificationDispatchService,
  ) {}

  /** Clôture période précédente + facture Stripe (quotidien 04:15 UTC). */
  @Cron(process.env.VENDOR_NOTIFICATION_BILLING_CRON ?? '15 4 * * *')
  async closePreviousPeriodCharges(): Promise<void> {
    const job = 'vendor-notification-period-billing';
    await this.cronMonitor.execute(job, async () => {
      const pricing = await this.dispatch.getPricing();
      if (!shouldClosePreviousBillingPeriod(new Date(), pricing.billingCyclePeriod)) {
        return;
      }
      const billingMonth = previousBillingPeriodKey(
        new Date(),
        pricing.billingCyclePeriod,
      );
      const result =
        await this.billing.closeMonthlyChargesForMonth(billingMonth);
      const issued =
        await this.stripeBilling.issueStripeInvoicesForMonth(billingMonth);
      this.logger.log(
        `Closed vendor SMS billing ${result.billingMonth} (${pricing.billingCyclePeriod}, ${result.stores} stores), Stripe issued=${issued.issued}`,
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
