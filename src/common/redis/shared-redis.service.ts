import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import {
  connectIoredisWithFailover,
  formatRedisTarget,
  listRedisCacheWriteConnectionsFromConfig,
  redisConnectionEquals,
  type RedisConnectionConfig,
} from './redis-connection.util';
import { registerAppCacheBustRedis } from '../redis-app-cache';

/** Connexion Redis partagée (OPT-007) — idempotence, compteurs SSE, etc. */
@Injectable()
export class SharedRedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SharedRedisService.name);
  private client: Redis | null = null;
  private connectPromise: Promise<boolean> | null = null;

  constructor(private readonly config: ConfigService) {}

  /** `REDIS_*` présent — requis pour tokens auth / idempotence multi-instance. */
  isConfigured(): boolean {
    return listRedisCacheWriteConnectionsFromConfig(this.config).length > 0;
  }

  onModuleInit(): void {
    void this.ensureConnected();
  }

  private _attachClient(client: Redis, connection: RedisConnectionConfig): void {
    this.client = client;
    this.client.on('error', (err) => {
      const msg = err.message ?? '';
      if (msg.includes('ECONNRESET')) return;
      this.logger.warn(`Shared Redis error: ${msg}`);
    });
    this.client.on('ready', () => {
      const bustClient = this.client as unknown as {
        get: (key: string) => Promise<string | null>;
        incr: (key: string) => Promise<number>;
      };
      registerAppCacheBustRedis(bustClient);
    });
    const primary = listRedisCacheWriteConnectionsFromConfig(this.config)[0];
    const role =
      primary && redisConnectionEquals(connection, primary)
        ? 'primary'
        : 'unexpected target';
    this.logger.log(
      `Shared Redis connected (${formatRedisTarget(connection)}, ${role})`,
    );
  }

  /** (Re)connexion idempotente — appelée au boot et après coupure Redis. */
  async ensureConnected(): Promise<boolean> {
    if (this.client?.status === 'ready') return true;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = (async () => {
      const candidates = listRedisCacheWriteConnectionsFromConfig(this.config);
      if (!candidates.length) {
        this.logger.log('Shared Redis disabled (REDIS_* absent)');
        return false;
      }
      if (this.client) {
        try {
          await this.client.quit();
        } catch {
          this.client.disconnect();
        }
        this.client = null;
      }
      try {
        const result = await connectIoredisWithFailover(candidates, {
          enableReadyCheck: true,
          lazyConnect: true,
          writeOnly: true,
        });
        if (!result) {
          this.logger.warn(
            `Shared Redis connect failed (${candidates.map(formatRedisTarget).join(' → ')})`,
          );
          return false;
        }
        this._attachClient(result.client, result.connection);
        return true;
      } catch (err) {
        this.logger.warn(
          `Shared Redis connect failed: ${(err as Error).message}`,
        );
        this.client = null;
        return false;
      } finally {
        this.connectPromise = null;
      }
    })();

    return this.connectPromise;
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
    if (!this.client) {
      await this.ensureConnected();
    }
    if (!this.client) return 0;
    try {
      const n = await this.client.incr(key);
      if (n === 1) {
        await this.client.expire(key, ttlSec);
      }
      return n;
    } catch {
      return 0;
    }
  }

  async decrFloorZero(key: string): Promise<void> {
    if (!this.client) return;
    try {
      const n = await this.client.decr(key);
      if (n <= 0) {
        await this.client.del(key);
      }
    } catch {
      /* best-effort */
    }
  }
}
