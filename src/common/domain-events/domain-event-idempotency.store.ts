import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  parsePositiveInt,
  readBullmqRedisConnectionFromConfig,
} from '../bullmq-redis-connection';

const REDIS_KEY_PREFIX = 'domain-event:idempotency:';

type MemoryEntry = { expiresAtMs: number };

@Injectable()
export class DomainEventIdempotencyStore
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DomainEventIdempotencyStore.name);
  private redis: Redis | null = null;
  private readonly memory = new Map<string, MemoryEntry>();

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const connection = readBullmqRedisConnectionFromConfig(this.config);
    if (!connection) {
      this.logger.log(
        'Domain event idempotency: in-memory fallback (REDIS_* absent)',
      );
      return;
    }
    this.redis = new Redis({
      host: connection.host,
      port: connection.port,
      username: connection.username,
      password: connection.password,
      tls: connection.tls,
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    this.redis.on('error', (err) => {
      this.logger.warn(`Domain event idempotency Redis error: ${err.message}`);
    });
    void this.redis.connect().catch((err: Error) => {
      this.logger.warn(
        `Domain event idempotency Redis connect failed: ${err.message}`,
      );
      this.redis?.disconnect();
      this.redis = null;
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      await this.redis.quit().catch(() => undefined);
      this.redis = null;
    }
    this.memory.clear();
  }

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

    if (this.redis) {
      try {
        const key = `${REDIS_KEY_PREFIX}${id}`;
        const result = await this.redis.set(key, '1', 'EX', this.ttlSec(), 'NX');
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
