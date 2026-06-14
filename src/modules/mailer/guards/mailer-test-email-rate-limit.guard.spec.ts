import { ExecutionContext, HttpException } from '@nestjs/common';
import { Types } from 'mongoose';
import { MailerTestEmailRateLimitGuard } from './mailer-test-email-rate-limit.guard';

function mockContext(userId?: string, ip = '127.0.0.1'): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        user: userId ? { _id: new Types.ObjectId(userId) } : undefined,
        ip,
      }),
    }),
  } as ExecutionContext;
}

describe('MailerTestEmailRateLimitGuard', () => {
  const guard = new MailerTestEmailRateLimitGuard();

  it('allows requests under the limit', () => {
    expect(guard.canActivate(mockContext('507f1f77bcf86cd799439011'))).toBe(
      true,
    );
  });

  it('blocks when the limit is exceeded', () => {
    const userId = '507f1f77bcf86cd799439012';
    for (let i = 0; i < 5; i += 1) {
      guard.canActivate(mockContext(userId));
    }
    expect(() => guard.canActivate(mockContext(userId))).toThrow(HttpException);
  });
});
