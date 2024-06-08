import { AuthModule } from '@modules/auth/auth.module';
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AddressModel, AddressSchema } from '@schemas/address.schema';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: AddressModel.name, schema: AddressSchema },
    ]),
  ],
  exports: [UsersService, MongooseModule],
})
export class UsersModule {}
