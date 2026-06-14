import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { UserModel } from '@schemas/user.schema';
import { MAILER_TEST_EMAIL_RATE_LIMIT } from '../mailer-test-email.util';

const requestTimestamps = new Map<string, number[]>();

@Injectable()
export class MailerTestEmailRateLimitGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      user?: UserModel;
      ip?: string;
    }>();
    const userId = req.user?._id?.toString();
    const key = userId ?? req.ip ?? 'anonymous';
    const now = Date.now();
    const windowStart = now - MAILER_TEST_EMAIL_RATE_LIMIT.windowMs;

    const recent = (requestTimestamps.get(key) ?? []).filter(
      (ts) => ts > windowStart,
    );
    if (recent.length >= MAILER_TEST_EMAIL_RATE_LIMIT.maxRequests) {
      throw new HttpException(
        'Limite de tests e-mail atteinte. Réessayez plus tard.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    recent.push(now);
    requestTimestamps.set(key, recent);
    return true;
  }
}
