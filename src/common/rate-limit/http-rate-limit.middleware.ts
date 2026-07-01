import type { NextFunction, Request, Response } from 'express';
import { RateLimitService } from './rate-limit.service';
import {
  buildRateLimitHeaders,
  clientIpFromRequest,
  isHttpRateLimitExempt,
  isSseRequestPath,
  normalizeRequestPath,
  readHttpRateLimitConfig,
} from './rate-limit.util';

export function httpRateLimitMiddleware(limiter: RateLimitService) {
  const cfg = readHttpRateLimitConfig(process.env);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!cfg.enabled) {
      next();
      return;
    }

    const path = normalizeRequestPath(req);
    const method = String(req.method ?? 'GET').toUpperCase();
    if (isHttpRateLimitExempt(path, method)) {
      next();
      return;
    }

    const ip = clientIpFromRequest(req);
    const bucket = isSseRequestPath(path) ? 'sse' : 'default';
    const limit = bucket === 'sse' ? cfg.sseMaxPerIp : cfg.maxPerIp;
    const key = `${cfg.keyPrefix}:http:${bucket}:${ip}`;

    void limiter.consume(key, limit, cfg.windowMs).then((result) => {
      const headers = buildRateLimitHeaders(result);
      for (const [name, value] of Object.entries(headers)) {
        res.setHeader(name, value);
      }
      if (!result.allowed) {
        res.status(429).json({
          statusCode: 429,
          message: 'rate_limit_exceeded',
          error: 'Too Many Requests',
        });
        return;
      }
      next();
    });
  };
}
