import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
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
import { UserModel, UserSchema } from '@schemas/user.schema';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: OrderModel.name, schema: OrderSchema },
      { name: StoreRatingModel.name, schema: StoreRatingSchema },
      { name: ProductRatingModel.name, schema: ProductRatingSchema },
      { name: StockItemModel.name, schema: StockItemSchema },
      { name: UserModel.name, schema: UserSchema },
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
