import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import {
  StripeProcessedCheckoutModel,
  StripeProcessedCheckoutSchema,
} from '@schemas/stripe-processed-checkout.schema';
import { TeamsModule } from '../teams/teams.module';
import { DbMaintenanceAdminController } from './db-maintenance-admin.controller';
import { DbMaintenanceService } from './db-maintenance.service';

@Module({
  imports: [
    TeamsModule,
    MongooseModule.forFeature([
      { name: OrderModel.name, schema: OrderSchema },
      {
        name: StripeProcessedCheckoutModel.name,
        schema: StripeProcessedCheckoutSchema,
      },
    ]),
  ],
  controllers: [DbMaintenanceAdminController],
  providers: [DbMaintenanceService],
})
export class DbMaintenanceModule {}
