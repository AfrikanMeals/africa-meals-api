import { CartModule } from '@modules/cart/cart.module';
import { ProductsModule } from '@modules/products/products.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AddressModel, AddressSchema } from '@schemas/address.schema';
import {
  ProductCategoryModel,
  ProductCategorySchema,
} from '@schemas/product-category.schema';
import {
  OrderStatusEventModel,
  OrderStatusEventSchema,
} from '@schemas/order-status-event.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import {
  ProductRatingModel,
  ProductRatingSchema,
} from '@schemas/product_rating.schema';
import {
  DeliveryDriverModel,
  DeliveryDriverSchema,
} from '@schemas/delivery-driver.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { OrdersDemoSeedService } from './orders-demo-seed.service';
import { ProductRatingsDemoSeedService } from './product-ratings-demo-seed.service';
import { OrderStatusEventsService } from './order-status-events.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { BusinessReportsModule } from '@modules/business-reports/business-reports.module';
import { WsNotifyModule } from '@modules/ws-notify/ws-notify.module';

@Module({
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderStatusEventsService,
    OrdersDemoSeedService,
    ProductRatingsDemoSeedService,
  ],
  exports: [OrdersService, OrderStatusEventsService],
  imports: [
    NotificationsModule,
    WsNotifyModule,
    BusinessReportsModule,
    CartModule,
    ProductsModule,
    MongooseModule.forFeature([
      { name: OrderModel.name, schema: OrderSchema },
      {
        name: OrderStatusEventModel.name,
        schema: OrderStatusEventSchema,
      },
      { name: ProductModel.name, schema: ProductSchema },
      { name: ProductRatingModel.name, schema: ProductRatingSchema },
      { name: StoreModel.name, schema: StoreSchema },
      { name: DeliveryDriverModel.name, schema: DeliveryDriverSchema },
      { name: UserModel.name, schema: UserSchema },
      { name: AddressModel.name, schema: AddressSchema },
      {
        name: ProductCategoryModel.name,
        schema: ProductCategorySchema,
      },
    ]),
  ],
})
export class OrdersModule {}
