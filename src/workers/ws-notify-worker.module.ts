import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullmqRedisModule } from '../common/redis/bullmq-redis-connections.service';
import { WsNotifyWorkerRunnerService } from './ws-notify-worker-runner.service';

/** GRPC-302 — worker BullMQ ws-notify externe (process séparé). */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), BullmqRedisModule],
  providers: [WsNotifyWorkerRunnerService],
})
export class WsNotifyWorkerModule {}
