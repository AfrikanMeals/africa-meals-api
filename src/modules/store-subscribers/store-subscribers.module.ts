import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { GraphModule } from '@modules/graph/graph.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  StoreSubscriberModel,
  StoreSubscriberSchema,
} from '@schemas/store-subscriber.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { StoreSubscribersService } from './store-subscribers.service';

@Module({
  imports: [
    SubscriptionsModule,
    TeamsModule,
    GraphModule,
    MongooseModule.forFeature([
      { name: StoreSubscriberModel.name, schema: StoreSubscriberSchema },
      { name: StoreModel.name, schema: StoreSchema },
    ]),
  ],
  providers: [StoreSubscribersService],
  exports: [StoreSubscribersService],
})
export class StoreSubscribersModule {}
