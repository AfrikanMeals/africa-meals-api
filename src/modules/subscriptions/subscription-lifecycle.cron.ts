import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Entretien abonnement:
 * - expire les plans payants arrivés à échéance
 * - attribue automatiquement FREE aux boutiques sans abonnement actif
 *
 * `SUBSCRIPTION_LIFECYCLE_CRON` — défaut toutes les 30 minutes.
 * `DISABLE_SUBSCRIPTION_LIFECYCLE_CRON=true` — désactive le job.
 */
@Injectable()
export class SubscriptionLifecycleCron {
  private readonly logger = new Logger(SubscriptionLifecycleCron.name);

  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Cron(process.env.SUBSCRIPTION_LIFECYCLE_CRON ?? '*/30 * * * *')
  async runScheduled(): Promise<void> {
    if (process.env.DISABLE_SUBSCRIPTION_LIFECYCLE_CRON === 'true') {
      return;
    }
    try {
      await this.subscriptions.reconcileSubscriptionLifecycle();
    } catch (e) {
      this.logger.error(
        `Subscription lifecycle cron failed: ${
          e instanceof Error ? e.stack ?? e.message : String(e)
        }`,
      );
    }
  }
}
