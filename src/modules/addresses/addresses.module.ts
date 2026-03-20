import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AddressModel, AddressSchema } from '@schemas/address.schema';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';

@Module({
  controllers: [AddressesController],
  providers: [AddressesService],
  imports: [
    MongooseModule.forFeature([
      { name: AddressModel.name, schema: AddressSchema },
      { name: UserModel.name, schema: UserSchema },
    ]),
  ],
  exports: [AddressesService, MongooseModule],
})
export class AddressesModule {}
