import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdModel, AdSchema } from '@schemas/ad.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import {
  InfraRuntimeSettingsModel,
  InfraRuntimeSettingsSchema,
} from '@schemas/infra-runtime-settings.schema';
import {
  StripeProcessedCheckoutModel,
  StripeProcessedCheckoutSchema,
} from '@schemas/stripe-processed-checkout.schema';
import { DrinkModel, DrinkSchema } from '@schemas/drink.schema';
import { ProductModel, ProductSchema } from '@schemas/product.schema';
import {
  StoreCouponModel,
  StoreCouponSchema,
} from '@schemas/store_coupon.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { SharedModule } from '../shared/shared.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { TeamsModule } from '../teams/teams.module';
import { WsNotifyModule } from '../ws-notify/ws-notify.module';
import { DbMaintenanceAdminController } from './db-maintenance-admin.controller';
import { DbMaintenanceService } from './db-maintenance.service';

@Module({
  imports: [
    TeamsModule,
    SharedModule,
    SubscriptionsModule,
    WsNotifyModule,
    MongooseModule.forFeature([
      { name: OrderModel.name, schema: OrderSchema },
      {
        name: StripeProcessedCheckoutModel.name,
        schema: StripeProcessedCheckoutSchema,
      },
      { name: StoreModel.name, schema: StoreSchema },
      { name: ProductModel.name, schema: ProductSchema },
      { name: DrinkModel.name, schema: DrinkSchema },
      { name: AdModel.name, schema: AdSchema },
      { name: StoreCouponModel.name, schema: StoreCouponSchema },
      {
        name: InfraRuntimeSettingsModel.name,
        schema: InfraRuntimeSettingsSchema,
      },
    ]),
  ],
  controllers: [DbMaintenanceAdminController],
  providers: [DbMaintenanceService],
})
export class DbMaintenanceModule {}
