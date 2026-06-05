import { CartModule } from '@modules/cart/cart.module';
import { LoyaltyModule } from '@modules/loyalty/loyalty.module';
import { ProductsModule } from '@modules/products/products.module';
import { AdsModule } from '@modules/ads/ads.module';
import { StripeConnectTransferModule } from '@modules/billing/stripe/stripe-connect-transfer.module';
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
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationSchema,
} from '@schemas/delivery-agent-application.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import {
  StripeProcessedCheckoutModel,
  StripeProcessedCheckoutSchema,
} from '@schemas/stripe-processed-checkout.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { OrdersDemoSeedService } from './orders-demo-seed.service';
import { ProductRatingsDemoSeedService } from './product-ratings-demo-seed.service';
import { OrderStatusEventsService } from './order-status-events.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { BusinessReportsModule } from '@modules/business-reports/business-reports.module';
import { WsNotifyModule } from '@modules/ws-notify/ws-notify.module';
import { MailerModule } from '@modules/mailer/mailer.module';
import { SupportedCountriesModule } from '@modules/supported-countries/supported-countries.module';
import { OrderInvoicePdfService } from './order-invoice-pdf.service';
import { OrderPaidInvoiceEmailService } from './order-paid-invoice-email.service';

@Module({
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderStatusEventsService,
    OrdersDemoSeedService,
    ProductRatingsDemoSeedService,
    OrderInvoicePdfService,
    OrderPaidInvoiceEmailService,
  ],
  exports: [OrdersService, OrderStatusEventsService],
  imports: [
    NotificationsModule,
    TeamsModule,
    WsNotifyModule,
    MailerModule,
    SupportedCountriesModule,
    BusinessReportsModule,
    CartModule,
    AdsModule,
    LoyaltyModule,
    ProductsModule,
    StripeConnectTransferModule,
    MongooseModule.forFeature([
      { name: OrderModel.name, schema: OrderSchema },
      {
        name: OrderStatusEventModel.name,
        schema: OrderStatusEventSchema,
      },
      { name: ProductModel.name, schema: ProductSchema },
      { name: ProductRatingModel.name, schema: ProductRatingSchema },
      { name: StoreModel.name, schema: StoreSchema },
      {
        name: StripeProcessedCheckoutModel.name,
        schema: StripeProcessedCheckoutSchema,
      },
      {
        name: DeliveryAgentApplicationModel.name,
        schema: DeliveryAgentApplicationSchema,
      },
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
