import { Module } from '@nestjs/common';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { StoreModule } from '@modules/store/store.module';
import { GrpcApiServerService } from './grpc-api-server.service';

@Module({
  imports: [StoreModule, NotificationsModule],
  providers: [GrpcApiServerService],
  exports: [GrpcApiServerService],
})
export class GrpcApiServerModule {}
