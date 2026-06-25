import { Module } from '@nestjs/common';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { StoreModule } from '@modules/store/store.module';
import { GrpcApiServerService } from './grpc-api-server.service';
import { GrpcVersionService } from './grpc-version.service';

@Module({
  imports: [StoreModule, NotificationsModule],
  providers: [GrpcVersionService, GrpcApiServerService],
  exports: [GrpcVersionService, GrpcApiServerService],
})
export class GrpcApiServerModule {}
