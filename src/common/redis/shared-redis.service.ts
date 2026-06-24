import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { readRedisConnectionFromConfig } from './redis-connection.util';

/** Connexion Redis partagée (OPT-007) — idempotence, compteurs SSE, etc. */
@Injectable()
export class SharedRedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SharedRedisService.name);
  private client: Redis | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const connection = readRedisConnectionFromConfig(this.config);
    if (!connection) {
      this.logger.log('Shared Redis disabled (REDIS_* absent)');
      return;
    }
    this.client = new Redis({
      host: connection.host,
      port: connection.port,
      username: connection.username,
      password: connection.password,
      tls: connection.tls,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    this.client.on('error', (err) => {
      this.logger.warn(`Shared Redis error: ${err.message}`);
    });
    void this.client.connect().then(() => {
      this.logger.log(
        `Shared Redis connected (${connection.host}:${connection.port})`,
      );
    }).catch((err: Error) => {
      this.logger.warn(`Shared Redis connect failed: ${err.message}`);
      this.client?.disconnect();
      this.client = null;
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => undefined);
      this.client = null;
    }
  }

  isEnabled(): boolean {
    return this.client != null && this.client.status === 'ready';
  }

  /** Client brut — ne pas `quit()` hors module destroy. */
  getClient(): Redis | null {
    return this.client;
  }

  async incrWithTtl(key: string, ttlSec: number): Promise<number> {
    if (!this.client) return 0;
    const n = await this.client.incr(key);
    if (n === 1) {
      await this.client.expire(key, ttlSec);
    }
    return n;
  }

  async decrFloorZero(key: string): Promise<void> {
    if (!this.client) return;
    const n = await this.client.decr(key);
    if (n <= 0) {
      await this.client.del(key);
    }
  }
}
