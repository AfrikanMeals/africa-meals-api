import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserModel } from '@schemas/user.schema';
import { Request } from 'express';
import {
  billingStripePaymentIntentRateLimitConfig,
  clientIpFromRequest,
} from './billing-stripe-payment-intent-rate-limit.util';

const requestTimestamps = new Map<string, number[]>();

function assertUnderLimit(
  key: string,
  windowMs: number,
  maxRequests: number,
): void {
  const now = Date.now();
  const windowStart = now - windowMs;
  const recent = (requestTimestamps.get(key) ?? []).filter(
    (ts) => ts > windowStart,
  );
  if (recent.length >= maxRequests) {
    throw new HttpException(
      'stripe_payment_intent_rate_limit_exceeded',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  recent.push(now);
  requestTimestamps.set(key, recent);
}

@Injectable()
export class BillingStripePaymentIntentRateLimitGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const limits = billingStripePaymentIntentRateLimitConfig({
      ...process.env,
      STRIPE_GROUPED_PI_RATE_LIMIT_ENABLED: this.config.get<string>(
        'STRIPE_GROUPED_PI_RATE_LIMIT_ENABLED',
      ),
      STRIPE_GROUPED_PI_RATE_LIMIT_WINDOW_MS: this.config.get<string>(
        'STRIPE_GROUPED_PI_RATE_LIMIT_WINDOW_MS',
      ),
      STRIPE_GROUPED_PI_RATE_LIMIT_MAX_PER_USER: this.config.get<string>(
        'STRIPE_GROUPED_PI_RATE_LIMIT_MAX_PER_USER',
      ),
      STRIPE_GROUPED_PI_RATE_LIMIT_MAX_PER_IP: this.config.get<string>(
        'STRIPE_GROUPED_PI_RATE_LIMIT_MAX_PER_IP',
      ),
    });

    if (!limits.enabled) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { user?: UserModel }>();
    const ip = clientIpFromRequest(req);
    assertUnderLimit(
      `stripe-grouped-pi:ip:${ip}`,
      limits.windowMs,
      limits.maxPerIp,
    );

    const userId = req.user?.id?.toString()?.trim();
    if (userId) {
      assertUnderLimit(
        `stripe-grouped-pi:user:${userId}`,
        limits.windowMs,
        limits.maxPerUser,
      );
    }

    return true;
  }
}
