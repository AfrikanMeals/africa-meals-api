import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import {
  ProductRatingModel,
  ProductRatingSchema,
} from '@schemas/product_rating.schema';
import {
  StockItemModel,
  StockItemSchema,
} from '@schemas/stock-item.schema';
import {
  StoreRatingModel,
  StoreRatingSchema,
} from '@schemas/store_rating.schema';
import {
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationSchema,
} from '@schemas/delivery-agent-application.schema';
import {
  DeliveryDriverModel,
  DeliveryDriverSchema,
} from '@schemas/delivery-driver.schema';
import { AddressModel, AddressSchema } from '@schemas/address.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { DeliveryDriversCityMigrationService } from './delivery-drivers-city-migration.service';
import { DeliveryDriversSeedService } from './delivery-drivers-seed.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { WsNotifyModule } from '@modules/ws-notify/ws-notify.module';

@Module({
  imports: [
    NotificationsModule,
    WsNotifyModule,
    OrdersModule,
    TeamsModule,
    MongooseModule.forFeature([
      { name: OrderModel.name, schema: OrderSchema },
      { name: StoreRatingModel.name, schema: StoreRatingSchema },
      { name: ProductRatingModel.name, schema: ProductRatingSchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: StockItemModel.name, schema: StockItemSchema },
      { name: UserModel.name, schema: UserSchema },
      { name: DeliveryDriverModel.name, schema: DeliveryDriverSchema },
      {
        name: DeliveryAgentApplicationModel.name,
        schema: DeliveryAgentApplicationSchema,
      },
      { name: StoreModel.name, schema: StoreSchema },
      { name: AddressModel.name, schema: AddressSchema },
    ]),
  ],
  controllers: [DashboardController],
  providers: [
    DashboardService,
    DeliveryDriversSeedService,
    DeliveryDriversCityMigrationService,
  ],
})
export class DashboardModule {}
