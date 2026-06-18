import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationSchema,
} from '@schemas/delivery-agent-application.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { StoreDeliveryDriversModule } from '@modules/store-delivery-drivers/store-delivery-drivers.module';
import { FleetAudienceService } from './fleet-audience.service';
import { FleetBootstrapService } from './fleet-bootstrap.service';
import { FleetSnapshotService } from './fleet-snapshot.service';

@Module({
  imports: [
    StoreDeliveryDriversModule,
    MongooseModule.forFeature([
      {
        name: DeliveryAgentApplicationModel.name,
        schema: DeliveryAgentApplicationSchema,
      },
      { name: OrderModel.name, schema: OrderSchema },
      { name: StoreModel.name, schema: StoreSchema },
    ]),
  ],
  providers: [FleetSnapshotService, FleetBootstrapService, FleetAudienceService],
  exports: [FleetSnapshotService, FleetBootstrapService, FleetAudienceService],
})
export class FleetModule {}
