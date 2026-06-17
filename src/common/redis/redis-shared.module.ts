import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SharedRedisService } from './shared-redis.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [SharedRedisService],
  exports: [SharedRedisService],
})
export class RedisSharedModule {}
