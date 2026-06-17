import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;
const hits = new Map<string, number[]>();

@Injectable()
export class AdNotificationTrackRateLimitGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const ip =
      String(req.headers['x-forwarded-for'] ?? '')
        .split(',')[0]
        ?.trim() ||
      req.ip ||
      'unknown';
    const now = Date.now();
    const windowStart = now - WINDOW_MS;
    const recent = (hits.get(ip) ?? []).filter((ts) => ts > windowStart);
    if (recent.length >= MAX_REQUESTS) {
      throw new HttpException('rate_limit_exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    hits.set(ip, recent);
    return true;
  }
}
