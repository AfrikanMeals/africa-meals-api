import { Injectable } from '@nestjs/common';
import { SharedRedisService } from '../redis/shared-redis.service';
import {
  consumeMemoryRateLimit,
  type RateLimitResult,
} from './rate-limit.util';

@Injectable()
export class RateLimitService {
  constructor(private readonly redis: SharedRedisService) {}

  async consume(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult> {
    const ttlSec = Math.max(1, Math.ceil(windowMs / 1000));
    const redisKey = `rl:${key}`;
    const redisCount = await this.redis.incrWithTtl(redisKey, ttlSec);

    if (redisCount > 0) {
      const allowed = redisCount <= limit;
      return {
        allowed,
        current: redisCount,
        limit,
        remaining: Math.max(0, limit - redisCount),
        retryAfterSec: allowed ? 0 : ttlSec,
      };
    }

    return consumeMemoryRateLimit(key, limit, windowMs);
  }
}
