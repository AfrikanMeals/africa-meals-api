import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  DeliveryAgentApplicationModel,
  DeliveryAgentApplicationSchema,
} from '@schemas/delivery-agent-application.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import { FleetBootstrapService } from './fleet-bootstrap.service';
import { FleetSnapshotService } from './fleet-snapshot.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: DeliveryAgentApplicationModel.name,
        schema: DeliveryAgentApplicationSchema,
      },
      { name: OrderModel.name, schema: OrderSchema },
    ]),
  ],
  providers: [FleetSnapshotService, FleetBootstrapService],
  exports: [FleetSnapshotService, FleetBootstrapService],
})
export class FleetModule {}
