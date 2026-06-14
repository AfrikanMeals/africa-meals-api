import { AddressesModule } from '@modules/addresses/addresses.module';
import { AuthModule } from '@modules/auth/auth.module';
import { LoyaltyModule } from '@modules/loyalty/loyalty.module';
import { StoreSubscribersModule } from '@modules/store-subscribers/store-subscribers.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AddressModel, AddressSchema } from '@schemas/address.schema';
import { OrderModel, OrderSchema } from '@schemas/order.schema';
import { StoreModel, StoreSchema } from '@schemas/store.schema';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  imports: [
    AuthModule,
    AddressesModule,
    LoyaltyModule,
    StoreSubscribersModule,
    MongooseModule.forFeature([
      { name: AddressModel.name, schema: AddressSchema },
      { name: StoreModel.name, schema: StoreSchema },
      { name: OrderModel.name, schema: OrderSchema },
    ]),
  ],
  exports: [UsersService, MongooseModule],
})
export class UsersModule {}
