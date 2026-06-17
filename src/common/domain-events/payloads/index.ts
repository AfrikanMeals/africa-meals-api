import type { DomainEventType } from '../domain-event-types';
import {
  AdClickPayload,
  AdConversionPayload,
  AdImpressionPayload,
} from './ad-domain-event.payloads';
import {
  AgentCapacityChangedPayload,
  AgentLocationUpdatedPayload,
  AgentPresenceChangedPayload,
} from './agent-domain-event.payloads';
import {
  JobCompletedPayload,
  JobFailedPayload,
  JobProgressPayload,
} from './job-domain-event.payloads';
import {
  OrderApprovedPayload,
  OrderCancelledPayload,
  OrderCreatedPayload,
  OrderDeliveredPayload,
  OrderPaidPayload,
  OrderShippedPayload,
  OrderTrackingUpdatedPayload,
} from './order-domain-event.payloads';
import {
  PaymentCheckoutCompletedPayload,
  PaymentConnectAccountUpdatedPayload,
  PaymentIntentSucceededPayload,
  SubscriptionCheckoutCompletedPayload,
} from './payment-domain-event.payloads';
import { SubscriptionTrialEndingPayload } from './subscription-domain-event.payloads';

export * from './ad-domain-event.payloads';
export * from './agent-domain-event.payloads';
export * from './job-domain-event.payloads';
export * from './order-domain-event.payloads';
export * from './payment-domain-event.payloads';
export * from './subscription-domain-event.payloads';

/** Mapping type-safe `type` → classe payload (v1). */
export interface DomainEventPayloadMap {
  'order.created': OrderCreatedPayload;
  'order.paid': OrderPaidPayload;
  'order.approved': OrderApprovedPayload;
  'order.shipped': OrderShippedPayload;
  'order.delivered': OrderDeliveredPayload;
  'order.cancelled': OrderCancelledPayload;
  'order.tracking.updated': OrderTrackingUpdatedPayload;
  'payment.checkout.completed': PaymentCheckoutCompletedPayload;
  'payment.intent.succeeded': PaymentIntentSucceededPayload;
  'payment.connect.account.updated': PaymentConnectAccountUpdatedPayload;
  'subscription.checkout.completed': SubscriptionCheckoutCompletedPayload;
  'subscription.trial.ending': SubscriptionTrialEndingPayload;
  'agent.presence.changed': AgentPresenceChangedPayload;
  'agent.location.updated': AgentLocationUpdatedPayload;
  'agent.capacity.changed': AgentCapacityChangedPayload;
  'ad.impression': AdImpressionPayload;
  'ad.click': AdClickPayload;
  'ad.conversion': AdConversionPayload;
  'job.progress': JobProgressPayload;
  'job.completed': JobCompletedPayload;
  'job.failed': JobFailedPayload;
}

export type DomainEventPayloadClass<T extends DomainEventType> = new () => DomainEventPayloadMap[T];
