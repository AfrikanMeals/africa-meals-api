import { AuthModule } from '@modules/auth/auth.module';
import { BillingModule } from '@modules/billing/billing.module';
import { VendorStatusEmailModule } from '@modules/vendor-emails/vendor-status-email.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { MailerModule } from '@modules/mailer/mailer.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { PlatformShippingSettingsModule } from '@modules/platform-shipping-settings/platform-shipping-settings.module';
import { SupportedCountriesModule } from '@modules/supported-countries/supported-countries.module';
import { StoreDeliveryDriversModule } from '@modules/store-delivery-drivers/store-delivery-drivers.module';
import { DeliveryOrderOfferModule } from '@modules/delivery-order-offer/delivery-order-offer.module';
import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';
import { WsNotifyModule } from '@modules/ws-notify/ws-notify.module';
import { FleetModule } from '@modules/fleet/fleet.module';
import { PendingDeliveryModule } from '@modules/pending-delivery/pending-delivery.module';
import { TrafficModule } from '@modules/traffic/traffic.module';
import { RouteOptimizationModule } from '@modules/route-optimization/route-optimization.module';
import { GraphModule } from '@modules/graph/graph.module';
import { MapEngineCacheModule } from '@modules/map-engine-cache/map-engine-cache.module';
import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationSchema,
} from '@schemas/delivery-agent-application.schema';
import {
  DeliveryAgentOrderRatingModel,
  DeliveryAgentOrderRatingSchema,
} from '@schemas/delivery-agent-order-rating.schema';
import {
  DeliveryAgentDailyPerformanceModel,
  DeliveryAgentDailyPerformanceSchema,
} from '@schemas/delivery-agent-daily-performance.schema';
import {
  DeliveryAgentPerformanceStatsModel,
  DeliveryAgentPerformanceStatsSchema,
} from '@schemas/delivery-agent-performance-stats.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { DeliveryAgentController } from './delivery-agent.controller';
import { DeliveryAgentService } from './delivery-agent.service';
import { CourierMarketplaceDispatchService } from './courier-marketplace-dispatch.service';
import { CourierPerformanceStatsService } from './courier-performance-stats.service';
import { CourierStatusPerformanceService } from './courier-status-performance.service';

@Module({
  imports: [
    AuthModule,
    MailerModule,
    NotificationsModule,
    BillingModule,
    VendorStatusEmailModule,
    forwardRef(() => OrdersModule),
    PlatformShippingSettingsModule,
    SupportedCountriesModule,
    forwardRef(() => StoreDeliveryDriversModule),
    forwardRef(() => DeliveryOrderOfferModule),
    SubscriptionsModule,
    FleetModule,
    PendingDeliveryModule,
    WsNotifyModule,
    TrafficModule,
    RouteOptimizationModule,
    GraphModule,
    MapEngineCacheModule,
    MongooseModule.forFeature([
      {
        name: DeliveryAgentApplicationModel.name,
        schema: DeliveryAgentApplicationSchema,
      },
      { name: UserModel.name, schema: UserSchema },
      { name: OrderModel.name, schema: OrderSchema },
      { name: StoreModel.name, schema: StoreSchema },
      {
        name: DeliveryAgentOrderRatingModel.name,
        schema: DeliveryAgentOrderRatingSchema,
      },
      {
        name: DeliveryAgentDailyPerformanceModel.name,
        schema: DeliveryAgentDailyPerformanceSchema,
      },
      {
        name: DeliveryAgentPerformanceStatsModel.name,
        schema: DeliveryAgentPerformanceStatsSchema,
      },
    ]),
  ],
  controllers: [DeliveryAgentController],
  providers: [
    DeliveryAgentService,
    CourierPerformanceStatsService,
    CourierStatusPerformanceService,
    CourierMarketplaceDispatchService,
  ],
  exports: [
    DeliveryAgentService,
    CourierPerformanceStatsService,
    CourierStatusPerformanceService,
    CourierMarketplaceDispatchService,
  ],
})
export class DeliveryAgentModule {}
