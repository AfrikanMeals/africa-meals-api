import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { SharedRedisService } from '../../common/redis/shared-redis.service';

export type OtpLinkFlow = 'verify' | 'reset';

export type OtpLinkPayload = {
  email: string;
  code: string;
  flow: OtpLinkFlow;
};

type MemoryRow = OtpLinkPayload & { expiresAt: number };

@Injectable()
export class OtpLinkTokenStore implements OnModuleInit {
  private readonly logger = new Logger(OtpLinkTokenStore.name);
  private readonly memory = new Map<string, MemoryRow>();

  constructor(private readonly sharedRedis: SharedRedisService) {}

  onModuleInit(): void {
    this.warnIfNoPersistentStore();
  }

  private redisClientOrWarn(): ReturnType<SharedRedisService['getClient']> {
    if (!this.sharedRedis.isConfigured()) return null;
    const client = this.sharedRedis.getClient();
    if (!client) {
      this.logger.error(
        'OTP link token store: REDIS_* configured but client unavailable — refusing in-memory fallback',
      );
    }
    return client;
  }

  private redisKey(token: string): string {
    return `auth:otp-link:${token}`;
  }

  async issue(payload: OtpLinkPayload, ttlSec: number): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    const row: OtpLinkPayload = {
      email: payload.email.trim().toLowerCase(),
      code: payload.code.trim().toUpperCase(),
      flow: payload.flow,
    };
    if (!row.email || !row.code || ttlSec <= 0) {
      throw new Error('invalid_otp_link_payload');
    }

    const client = this.redisClientOrWarn();
    if (client) {
      await client.set(this.redisKey(token), JSON.stringify(row), 'EX', ttlSec);
      return token;
    }
    if (this.sharedRedis.isConfigured()) {
      throw new Error('otp_link_store_unavailable');
    }

    this.memory.set(token, { ...row, expiresAt: Date.now() + ttlSec * 1000 });
    return token;
  }

  async consume(tokenRaw: string): Promise<OtpLinkPayload | null> {
    const token = tokenRaw.trim();
    if (!token) return null;

    const client = this.redisClientOrWarn();
    if (client) {
      const key = this.redisKey(token);
      const raw = await client.get(key);
      if (!raw) return null;
      await client.del(key);
      try {
        return JSON.parse(raw) as OtpLinkPayload;
      } catch {
        return null;
      }
    }
    if (this.sharedRedis.isConfigured()) return null;

    const row = this.memory.get(token);
    if (!row || row.expiresAt < Date.now()) {
      this.memory.delete(token);
      return null;
    }
    this.memory.delete(token);
    return {
      email: row.email,
      code: row.code,
      flow: row.flow,
    };
  }

  warnIfNoPersistentStore(): void {
    if (!this.sharedRedis.isConfigured()) {
      this.logger.warn(
        'OTP link tokens use in-memory store (REDIS_* absent) — not suitable for multi-instance production',
      );
    }
  }
}
