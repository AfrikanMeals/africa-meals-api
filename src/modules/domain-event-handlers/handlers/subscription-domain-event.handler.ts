import { Injectable, Logger } from '@nestjs/common';
import { DomainEventEnvelope } from '../../../common/domain-events/domain-event.types';
import { SubscriptionTrialEndingPayload } from '../../../common/domain-events/payloads/subscription-domain-event.payloads';
import { SubscriptionTrialReminderService } from '@modules/subscriptions/subscription-trial-reminder.service';

@Injectable()
export class SubscriptionDomainEventHandler {
  private readonly logger = new Logger(SubscriptionDomainEventHandler.name);

  constructor(
    private readonly trialReminders: SubscriptionTrialReminderService,
  ) {}

  async handle(envelope: DomainEventEnvelope): Promise<void> {
    switch (envelope.type) {
      case 'subscription.trial.ending':
        await this.onTrialEnding(envelope.payload as SubscriptionTrialEndingPayload);
        break;
      default:
        break;
    }
  }

  private async onTrialEnding(
    payload: SubscriptionTrialEndingPayload,
  ): Promise<void> {
    try {
      await this.trialReminders.processTrialEndingReminder(payload);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `subscription.trial.ending failed sub=${payload.subscriptionId}: ${msg}`,
      );
    }
  }
}
