import { Global, Module } from '@nestjs/common';
import { RedisSharedModule } from '../redis/redis-shared.module';
import { SseRedisPublishService } from './sse-redis-publish.service';

@Global()
@Module({
  imports: [RedisSharedModule],
  providers: [SseRedisPublishService],
  exports: [SseRedisPublishService],
})
export class SseRedisModule {}
