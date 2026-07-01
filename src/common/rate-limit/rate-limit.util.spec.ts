import {
  consumeMemoryRateLimit,
  isHttpRateLimitExempt,
  isSseRequestPath,
  readHttpRateLimitConfig,
} from './rate-limit.util';

describe('rate-limit.util', () => {
  it('reads HTTP rate limit defaults', () => {
    expect(readHttpRateLimitConfig({})).toEqual({
      enabled: true,
      windowMs: 60_000,
      maxPerIp: 120,
      sseMaxPerIp: 40,
      keyPrefix: 'api',
    });
  });

  it('exempts health, metrics, webhooks and OPTIONS', () => {
    expect(isHttpRateLimitExempt('/api/health', 'GET')).toBe(true);
    expect(isHttpRateLimitExempt('/metrics', 'GET')).toBe(true);
    expect(isHttpRateLimitExempt('/api/billing/stripe/webhook', 'POST')).toBe(
      true,
    );
    expect(isHttpRateLimitExempt('/api/auth/login', 'OPTIONS')).toBe(true);
    expect(isHttpRateLimitExempt('/api/auth/login', 'POST')).toBe(false);
  });

  it('detects SSE paths', () => {
    expect(isSseRequestPath('/api/sse/public-status')).toBe(true);
    expect(isSseRequestPath('/api/chat/inbox')).toBe(false);
  });

  it('blocks after max requests in memory window', () => {
    const key = 'test:memory';
    const limit = 2;
    const windowMs = 60_000;
    expect(consumeMemoryRateLimit(key, limit, windowMs, 1_000).allowed).toBe(
      true,
    );
    expect(consumeMemoryRateLimit(key, limit, windowMs, 2_000).allowed).toBe(
      true,
    );
    const blocked = consumeMemoryRateLimit(key, limit, windowMs, 3_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });
});
