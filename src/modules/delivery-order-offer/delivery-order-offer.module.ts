import { CronMonitorModule } from '@modules/cron-monitor/cron-monitor.module';
import { DeliveryAgentModule } from '@modules/delivery-agent/delivery-agent.module';
import { FleetModule } from '@modules/fleet/fleet.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { RouteOptimizationModule } from '@modules/route-optimization/route-optimization.module';
import { StoreDeliveryDriversModule } from '@modules/store-delivery-drivers/store-delivery-drivers.module';
import { TrafficModule } from '@modules/traffic/traffic.module';
import { WsNotifyModule } from '@modules/ws-notify/ws-notify.module';
import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationSchema,
} from '@schemas/delivery-agent-application.schema';
import {
  DeliveryOrderOfferModel,
  DeliveryOrderOfferSchema,
} from '@schemas/delivery-order-offer.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { DeliveryOrderOfferCron } from './delivery-order-offer.cron';
import { DeliveryOrderOfferService } from './delivery-order-offer.service';

@Module({
  imports: [
    NotificationsModule,
    WsNotifyModule,
    CronMonitorModule,
    StoreDeliveryDriversModule,
    FleetModule,
    RouteOptimizationModule,
    TrafficModule,
    forwardRef(() => OrdersModule),
    forwardRef(() => DeliveryAgentModule),
    MongooseModule.forFeature([
      {
        name: DeliveryOrderOfferModel.name,
        schema: DeliveryOrderOfferSchema,
      },
      { name: OrderModel.name, schema: OrderSchema },
      { name: StoreModel.name, schema: StoreSchema },
      { name: UserModel.name, schema: UserSchema },
      {
        name: DeliveryAgentApplicationModel.name,
        schema: DeliveryAgentApplicationSchema,
      },
    ]),
  ],
  providers: [DeliveryOrderOfferService, DeliveryOrderOfferCron],
  exports: [DeliveryOrderOfferService],
})
export class DeliveryOrderOfferModule {}
