import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationSchema,
} from '@schemas/delivery-agent-application.schema';
import {
  DeliveryAgentOrderRatingModel,
  DeliveryAgentOrderRatingSchema,
} from '@schemas/delivery-agent-order-rating.schema';
import {
  DeliveryAgentPerformanceStatsModel,
  DeliveryAgentPerformanceStatsSchema,
} from '@schemas/delivery-agent-performance-stats.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { CourierPerformanceStatsService } from './courier-performance-stats.service';
import { CourierStatusPerformanceService } from './courier-status-performance.service';

/**
 * Isole les lectures Performance & Statut des modules livraison et boutique.
 * Cette frontière évite le cycle DeliveryAgentModule ↔ StoreDeliveryDriversModule.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: DeliveryAgentApplicationModel.name,
        schema: DeliveryAgentApplicationSchema,
      },
      {
        name: DeliveryAgentOrderRatingModel.name,
        schema: DeliveryAgentOrderRatingSchema,
      },
      {
        name: DeliveryAgentPerformanceStatsModel.name,
        schema: DeliveryAgentPerformanceStatsSchema,
      },
      { name: OrderModel.name, schema: OrderSchema },
      { name: UserModel.name, schema: UserSchema },
    ]),
  ],
  providers: [
    CourierPerformanceStatsService,
    CourierStatusPerformanceService,
  ],
  exports: [
    CourierPerformanceStatsService,
    CourierStatusPerformanceService,
  ],
})
export class CourierPerformanceModule {}
