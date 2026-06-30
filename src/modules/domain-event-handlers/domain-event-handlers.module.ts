import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdsModule } from '@modules/ads/ads.module';
import { BillingModule } from '@modules/billing/billing.module';
import { LoyaltyModule } from '@modules/loyalty/loyalty.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { RefundsModule } from '@modules/refunds/refunds.module';
import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';
import { WsNotifyModule } from '@modules/ws-notify/ws-notify.module';
import { FleetModule } from '@modules/fleet/fleet.module';
import { AdminJobsModule } from '@modules/admin-jobs/admin-jobs.module';
import { CheckoutSessionSseModule } from '@modules/sse-stream/checkout-session-sse.module';
import { DomainEventHandlersService } from './domain-event-handlers.service';
import { DomainEventHandlersBootstrapService } from './domain-event-handlers-bootstrap.service';
import { AdDomainEventHandler } from './handlers/ad-domain-event.handler';
import { AgentDomainEventHandler } from './handlers/agent-domain-event.handler';
import { JobDomainEventHandler } from './handlers/job-domain-event.handler';
import { OrderDomainEventHandler } from './handlers/order-domain-event.handler';
import { PaymentDomainEventHandler } from './handlers/payment-domain-event.handler';
import { RefundDomainEventHandler } from './handlers/refund-domain-event.handler';
import { WsOrderNotifyHandler } from './handlers/ws-order-notify.handler';
import { SubscriptionDomainEventHandler } from './handlers/subscription-domain-event.handler';
import { OrderDomainBridgeService } from './order-domain-bridge.service';

@Module({
  imports: [
    ConfigModule,
    AdminJobsModule,
    FleetModule,
    WsNotifyModule,
    NotificationsModule,
    LoyaltyModule,
    forwardRef(() => OrdersModule),
    forwardRef(() => BillingModule),
    forwardRef(() => RefundsModule),
    forwardRef(() => SubscriptionsModule),
    forwardRef(() => AdsModule),
    CheckoutSessionSseModule,
  ],
  providers: [
    DomainEventHandlersService,
    DomainEventHandlersBootstrapService,
    OrderDomainBridgeService,
    OrderDomainEventHandler,
    PaymentDomainEventHandler,
    AgentDomainEventHandler,
    AdDomainEventHandler,
    RefundDomainEventHandler,
    WsOrderNotifyHandler,
    JobDomainEventHandler,
    SubscriptionDomainEventHandler,
  ],
  exports: [
    DomainEventHandlersService,
    OrderDomainBridgeService,
    WsOrderNotifyHandler,
    AdminJobsModule,
  ],
})
export class DomainEventHandlersModule {}
