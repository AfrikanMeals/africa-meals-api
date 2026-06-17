import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SharedRedisService } from '../../common/redis/shared-redis.service';

type MemoryRow = { userId: string; expiresAt: number };

/**
 * Sessions refresh rotatives (H-03) — jti à usage unique.
 * Redis en prod ; Map mémoire en local sans Redis.
 */
@Injectable()
export class RefreshTokenStore implements OnModuleInit {
  private readonly logger = new Logger(RefreshTokenStore.name);
  private readonly memory = new Map<string, MemoryRow>();

  constructor(private readonly sharedRedis: SharedRedisService) {}

  onModuleInit(): void {
    this.warnIfNoPersistentStore();
  }

  private redisKey(jti: string): string {
    return `auth:refresh:jti:${jti}`;
  }

  async register(jti: string, userId: string, ttlSec: number): Promise<void> {
    const id = jti.trim();
    const uid = userId.trim();
    if (!id || !uid || ttlSec <= 0) return;

    if (this.sharedRedis.isEnabled()) {
      const client = this.sharedRedis.getClient();
      if (client) {
        await client.set(
          this.redisKey(id),
          JSON.stringify({ userId: uid }),
          'EX',
          ttlSec,
        );
        return;
      }
    }

    this.memory.set(id, {
      userId: uid,
      expiresAt: Date.now() + ttlSec * 1000,
    });
  }

  /** Consomme le jti (rotation) — retourne false si absent ou userId incorrect. */
  async consume(jti: string, expectedUserId: string): Promise<boolean> {
    const id = jti.trim();
    const uid = expectedUserId.trim();
    if (!id || !uid) return false;

    if (this.sharedRedis.isEnabled()) {
      const client = this.sharedRedis.getClient();
      if (client) {
        const key = this.redisKey(id);
        const raw = await client.get(key);
        if (!raw) return false;
        await client.del(key);
        try {
          const row = JSON.parse(raw) as { userId?: string };
          return row.userId === uid;
        } catch {
          return false;
        }
      }
    }

    const row = this.memory.get(id);
    if (!row || row.expiresAt < Date.now()) {
      this.memory.delete(id);
      return false;
    }
    this.memory.delete(id);
    return row.userId === uid;
  }

  warnIfNoPersistentStore(): void {
    if (!this.sharedRedis.isEnabled()) {
      this.logger.warn(
        'Refresh token rotation uses in-memory store (REDIS_* absent) — not suitable for multi-instance production',
      );
    }
  }
}
