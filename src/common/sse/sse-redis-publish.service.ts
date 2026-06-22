import { Injectable, Logger } from '@nestjs/common';
import { SharedRedisService } from '../redis/shared-redis.service';
import {
  isSseRedisBridgeEnabled,
  SSE_REDIS_CHANNELS,
  SSE_REDIS_LAST_KEYS,
  SSE_REDIS_LAST_TTL_SEC,
} from './sse-redis.channels';

@Injectable()
export class SseRedisPublishService {
  private readonly logger = new Logger(SseRedisPublishService.name);

  constructor(private readonly sharedRedis: SharedRedisService) {}

  private enabled(): boolean {
    return isSseRedisBridgeEnabled() && this.sharedRedis.isEnabled();
  }

  private async push(
    channel: string,
    lastKey: string,
    payload: Record<string, unknown>,
    ttlSec = SSE_REDIS_LAST_TTL_SEC,
  ): Promise<void> {
    if (!this.enabled()) return;
    const client = this.sharedRedis.getClient();
    if (!client) return;
    try {
      const body = JSON.stringify(payload);
      await client.set(lastKey, body, 'EX', ttlSec);
      await client.publish(channel, body);
    } catch (e) {
      this.logger.warn(
        `SSE Redis publish failed ch=${channel}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  async publishReindex(payload: Record<string, unknown>): Promise<void> {
    await this.push(
      SSE_REDIS_CHANNELS.reindex,
      SSE_REDIS_LAST_KEYS.reindex,
      payload,
    );
  }

  async publishFleet(payload: Record<string, unknown>): Promise<void> {
    await this.push(
      SSE_REDIS_CHANNELS.fleet,
      SSE_REDIS_LAST_KEYS.fleet,
      payload,
    );
  }

  async publishHealth(payload: Record<string, unknown>): Promise<void> {
    await this.push(
      SSE_REDIS_CHANNELS.health,
      SSE_REDIS_LAST_KEYS.health,
      payload,
      300,
    );
  }

  async publishStatus(payload: Record<string, unknown>): Promise<void> {
    await this.push(
      SSE_REDIS_CHANNELS.status,
      SSE_REDIS_LAST_KEYS.status,
      payload,
      120,
    );
  }

  async publishJob(
    jobId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const id = jobId.trim();
    if (!id) return;
    await this.push(
      SSE_REDIS_CHANNELS.job(id),
      SSE_REDIS_LAST_KEYS.job(id),
      payload,
      3600,
    );
  }

  async publishCheckout(
    sessionId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const id = sessionId.trim();
    if (!id) return;
    await this.push(
      SSE_REDIS_CHANNELS.checkout(id),
      SSE_REDIS_LAST_KEYS.checkout(id),
      payload,
      3600,
    );
  }

  async publishRequestStats(payload: Record<string, unknown>): Promise<void> {
    await this.push(
      SSE_REDIS_CHANNELS.requestStats,
      SSE_REDIS_LAST_KEYS.requestStats,
      payload,
      60,
    );
  }

  async publishPlatformMaintenance(
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.push(
      SSE_REDIS_CHANNELS.platformMaintenance,
      SSE_REDIS_LAST_KEYS.platformMaintenance,
      payload,
      86_400,
    );
  }
}
