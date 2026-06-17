import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import {
  AUTH_RATE_LIMIT_PROFILES,
  authRateLimitKey,
  isAuthRateLimitEnabled,
  type AuthRateLimitProfile,
} from '../auth-rate-limit.util';
import { AUTH_RATE_LIMIT_KEY } from '../decorators/auth-rate-limit.decorator';

const requestTimestamps = new Map<string, number[]>();

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (!isAuthRateLimitEnabled(this.config.get<string>('AUTH_RATE_LIMIT_ENABLED'))) {
      return true;
    }

    const profile = this.reflector.getAllAndOverride<AuthRateLimitProfile | undefined>(
      AUTH_RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!profile) return true;

    const limits = AUTH_RATE_LIMIT_PROFILES[profile];
    const req = context.switchToHttp().getRequest<Request>();
    const ip =
      String(req.headers['x-forwarded-for'] ?? '')
        .split(',')[0]
        ?.trim() ||
      req.ip ||
      'unknown';
    const body = req.body as { email?: unknown } | undefined;
    const email =
      typeof body?.email === 'string' ? body.email : undefined;
    const key = authRateLimitKey(profile, ip, email);
    const now = Date.now();
    const windowStart = now - limits.windowMs;
    const recent = (requestTimestamps.get(key) ?? []).filter(
      (ts) => ts > windowStart,
    );
    if (recent.length >= limits.maxRequests) {
      throw new HttpException(
        'Trop de tentatives. Réessayez plus tard.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    requestTimestamps.set(key, recent);
    return true;
  }
}
