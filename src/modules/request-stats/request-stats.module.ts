import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { AdEventModel, AdEventSchema } from '@schemas/ad-event.schema';
import { AdModel, AdSchema } from '@schemas/ad.schema';
import { CartItemModel, CartItemSchema } from '@schemas/cart_item.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import {
  StoreCouponModel,
  StoreCouponSchema,
} from '@schemas/store_coupon.schema';
import { GiftCodeModel, GiftCodeSchema } from '@schemas/gift_code.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import {
  VendorAnalyticsEventModel,
  VendorAnalyticsEventSchema,
} from '@schemas/vendor-analytics-event.schema';
import { DrinkModel, DrinkSchema } from '@schemas/drink.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import { StoreModule } from '../store/store.module';
import { TeamsModule } from '../teams/teams.module';
import { RequestStatsAdminController } from './request-stats-admin.controller';
import { RequestStatsCollectController } from './request-stats-collect.controller';
import { RequestStatsInterceptor } from './request-stats.interceptor';
import { RequestStatsService } from './request-stats.service';
import { RequestStatsStore } from './request-stats.store';
import { VendorAnalyticsCollectService } from './vendor-analytics-collect.service';

@Module({
  imports: [
    TeamsModule,
    StoreModule,
    MongooseModule.forFeature([
      { name: StoreModel.name, schema: StoreSchema },
      { name: OrderModel.name, schema: OrderSchema },
      { name: CartItemModel.name, schema: CartItemSchema },
      { name: AdModel.name, schema: AdSchema },
      { name: AdEventModel.name, schema: AdEventSchema },
      { name: StoreCouponModel.name, schema: StoreCouponSchema },
      { name: GiftCodeModel.name, schema: GiftCodeSchema },
      { name: VendorAnalyticsEventModel.name, schema: VendorAnalyticsEventSchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: DrinkModel.name, schema: DrinkSchema },
    ]),
  ],
  controllers: [RequestStatsAdminController, RequestStatsCollectController],
  providers: [
    RequestStatsStore,
    RequestStatsService,
    VendorAnalyticsCollectService,
    RequestStatsInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestStatsInterceptor,
    },
  ],
  exports: [RequestStatsStore, RequestStatsService],
})
export class RequestStatsModule {}
