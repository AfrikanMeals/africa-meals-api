import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { StoreModule } from '@modules/store/store.module';
import { CartModule } from '@modules/cart/cart.module';
import { UserModel, UserSchema } from '@schemas/user.schema';
import { GrpcApiServerService } from './grpc-api-server.service';
import { GrpcVersionService } from './grpc-version.service';

@Module({
  imports: [
    StoreModule,
    NotificationsModule,
    CartModule,
    MongooseModule.forFeature([{ name: UserModel.name, schema: UserSchema }]),
  ],
  providers: [GrpcVersionService, GrpcApiServerService],
  exports: [GrpcVersionService, GrpcApiServerService],
})
export class GrpcApiServerModule {}
