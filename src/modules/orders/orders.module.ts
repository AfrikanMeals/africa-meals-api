import { CartModule } from '@modules/cart/cart.module';
import { ProductsModule } from '@modules/products/products.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AddressModel, AddressSchema } from '@schemas/address.schema';
import {
  ProductCategoryModel,
  ProductCategorySchema,
} from '@schemas/product-category.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { OrdersDemoSeedService } from './orders-demo-seed.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, OrdersDemoSeedService],
  exports: [OrdersService],
  imports: [
    CartModule,
    ProductsModule,
    MongooseModule.forFeature([
      { name: OrderModel.name, schema: OrderSchema },
      { name: StoreModel.name, schema: StoreSchema },
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
