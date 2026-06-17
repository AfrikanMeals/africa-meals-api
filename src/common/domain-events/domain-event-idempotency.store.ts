import {
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parsePositiveInt } from '../bullmq-redis-connection';
import { SharedRedisService } from '../redis/shared-redis.service';

const REDIS_KEY_PREFIX = 'domain-event:idempotency:';

type MemoryEntry = { expiresAtMs: number };

@Injectable()
export class DomainEventIdempotencyStore {
  private readonly logger = new Logger(DomainEventIdempotencyStore.name);
  private readonly memory = new Map<string, MemoryEntry>();

  constructor(
    private readonly config: ConfigService,
    private readonly sharedRedis: SharedRedisService,
  ) {}

  private ttlSec(): number {
    return parsePositiveInt(
      this.config.get<string>('DOMAIN_EVENTS_IDEMPOTENCY_TTL_SEC'),
      86_400,
    );
  }

  private purgeExpiredMemory(): void {
    const now = Date.now();
    for (const [key, entry] of this.memory.entries()) {
      if (entry.expiresAtMs <= now) {
        this.memory.delete(key);
      }
    }
  }

  /**
   * Retourne `true` si l'eventId n'a jamais été vu (claim réussi).
   * Retourne `false` si doublon — ne pas republier.
   */
  async tryClaim(eventId: string): Promise<boolean> {
    const id = eventId.trim();
    if (!id) return false;

    const redis = this.sharedRedis.getClient();
    if (redis) {
      try {
        const key = `${REDIS_KEY_PREFIX}${id}`;
        const result = await redis.set(key, '1', 'EX', this.ttlSec(), 'NX');
        return result === 'OK';
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Idempotency Redis claim failed: ${msg}`);
      }
    }

    this.purgeExpiredMemory();
    if (this.memory.has(id)) return false;
    this.memory.set(id, {
      expiresAtMs: Date.now() + this.ttlSec() * 1000,
    });
    return true;
  }
}
