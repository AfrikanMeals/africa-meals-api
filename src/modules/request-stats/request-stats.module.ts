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
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { TeamsModule } from '../teams/teams.module';
import { RequestStatsAdminController } from './request-stats-admin.controller';
import { RequestStatsCollectController } from './request-stats-collect.controller';
import { RequestStatsInterceptor } from './request-stats.interceptor';
import { RequestStatsService } from './request-stats.service';
import { RequestStatsStore } from './request-stats.store';

@Module({
  imports: [
    TeamsModule,
    MongooseModule.forFeature([
      { name: StoreModel.name, schema: StoreSchema },
      { name: OrderModel.name, schema: OrderSchema },
      { name: CartItemModel.name, schema: CartItemSchema },
      { name: AdModel.name, schema: AdSchema },
      { name: AdEventModel.name, schema: AdEventSchema },
      { name: StoreCouponModel.name, schema: StoreCouponSchema },
    ]),
  ],
  controllers: [RequestStatsAdminController, RequestStatsCollectController],
  providers: [
    RequestStatsStore,
    RequestStatsService,
    RequestStatsInterceptor,
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestStatsInterceptor,
    },
  ],
  exports: [RequestStatsStore, RequestStatsService],
})
export class RequestStatsModule {}
