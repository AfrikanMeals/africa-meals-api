import type { Request } from 'express';
import { isAcmeChallengePath } from '../http/acme-challenge.middleware';

export type RateLimitResult = {
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
  retryAfterSec: number;
};

export type HttpRateLimitConfig = {
  enabled: boolean;
  windowMs: number;
  maxPerIp: number;
  sseMaxPerIp: number;
  keyPrefix: string;
};

export type WsEventRateLimitConfig = {
  enabled: boolean;
  windowMs: number;
  messageSendMax: number;
  typingMax: number;
  keyPrefix: string;
};

const memoryWindows = new Map<string, number[]>();

export function parseBooleanEnv(
  raw: string | undefined,
  fallback = true,
): boolean {
  const v = String(raw ?? (fallback ? 'true' : 'false'))
    .trim()
    .toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'off';
}

export function parsePositiveIntEnv(
  raw: string | undefined,
  fallback: number,
): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

export function readHttpRateLimitConfig(env: NodeJS.ProcessEnv): HttpRateLimitConfig {
  return {
    enabled: parseBooleanEnv(env.HTTP_RATE_LIMIT_ENABLED, true),
    windowMs: parsePositiveIntEnv(env.HTTP_RATE_LIMIT_WINDOW_MS, 60_000),
    maxPerIp: parsePositiveIntEnv(env.HTTP_RATE_LIMIT_MAX_PER_IP, 120),
    sseMaxPerIp: parsePositiveIntEnv(env.HTTP_RATE_LIMIT_SSE_MAX_PER_IP, 40),
    keyPrefix: String(env.HTTP_RATE_LIMIT_KEY_PREFIX ?? 'api').trim() || 'api',
  };
}

export function readWsEventRateLimitConfig(
  env: NodeJS.ProcessEnv,
): WsEventRateLimitConfig {
  return {
    enabled: parseBooleanEnv(env.WS_RATE_LIMIT_ENABLED, true),
    windowMs: parsePositiveIntEnv(
      env.WS_RATE_LIMIT_WINDOW_MS ?? env.HTTP_RATE_LIMIT_WINDOW_MS,
      60_000,
    ),
    messageSendMax: parsePositiveIntEnv(env.WS_RATE_LIMIT_MESSAGE_SEND_MAX, 40),
    typingMax: parsePositiveIntEnv(env.WS_RATE_LIMIT_TYPING_MAX, 80),
    keyPrefix: String(env.HTTP_RATE_LIMIT_KEY_PREFIX ?? 'ws').trim() || 'ws',
  };
}

export function normalizeRequestPath(req: Request): string {
  const raw = req.originalUrl ?? req.url ?? '';
  return (raw.split('?')[0] ?? raw).trim();
}

export function clientIpFromRequest(req: Request): string {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')[0]
    ?.trim();
  return forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
}

export function isHttpRateLimitExempt(path: string, method: string): boolean {
  if (method === 'OPTIONS') return true;
  const p = path.toLowerCase();
  if (!p) return false;
  if (/\/health(?:\/|$)/.test(p)) return true;
  if (/\/metrics(?:\/|$)/.test(p)) return true;
  if (p === '/robots.txt' || p.endsWith('/robots.txt')) return true;
  if (isAcmeChallengePath(p)) return true;
  if (p.includes('/stripe/webhook') || p.includes('/billing/stripe/webhook')) {
    return true;
  }
  return false;
}

export function isSseRequestPath(path: string): boolean {
  return /\/sse(?:\/|$)/i.test(path);
}

export function consumeMemoryRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  const windowStart = now - windowMs;
  const recent = (memoryWindows.get(key) ?? []).filter((ts) => ts > windowStart);
  const ttlSec = Math.max(1, Math.ceil(windowMs / 1000));

  if (recent.length >= limit) {
    const oldest = recent[0] ?? now;
    const retryAfterSec = Math.max(
      1,
      Math.ceil((oldest + windowMs - now) / 1000),
    );
    return {
      allowed: false,
      current: recent.length,
      limit,
      remaining: 0,
      retryAfterSec,
    };
  }

  recent.push(now);
  memoryWindows.set(key, recent);
  return {
    allowed: true,
    current: recent.length,
    limit,
    remaining: Math.max(0, limit - recent.length),
    retryAfterSec: 0,
  };
}

export function buildRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
  };
  if (!result.allowed) {
    headers['Retry-After'] = String(result.retryAfterSec);
  }
  return headers;
}
