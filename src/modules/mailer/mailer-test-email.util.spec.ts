import {
  isMailerTestEmailEnabled,
  MAILER_TEST_EMAIL_RATE_LIMIT,
} from './mailer-test-email.util';

describe('mailer-test-email.util', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ENABLE_MAILER_TEST_EMAIL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('isMailerTestEmailEnabled', () => {
    it('returns false in production regardless of flag', () => {
      process.env.NODE_ENV = 'production';
      process.env.ENABLE_MAILER_TEST_EMAIL = 'true';
      expect(isMailerTestEmailEnabled()).toBe(false);
    });

    it('returns false outside production when flag is absent', () => {
      process.env.NODE_ENV = 'development';
      expect(isMailerTestEmailEnabled()).toBe(false);
    });

    it('returns true outside production when explicitly enabled', () => {
      process.env.NODE_ENV = 'local';
      process.env.ENABLE_MAILER_TEST_EMAIL = 'true';
      expect(isMailerTestEmailEnabled()).toBe(true);
    });
  });

  it('defines a conservative rate limit', () => {
    expect(MAILER_TEST_EMAIL_RATE_LIMIT.maxRequests).toBeLessThanOrEqual(10);
    expect(MAILER_TEST_EMAIL_RATE_LIMIT.windowMs).toBeGreaterThan(0);
  });
});
