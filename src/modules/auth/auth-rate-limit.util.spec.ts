import {
  authRateLimitKey,
  isAuthRateLimitEnabled,
} from './auth-rate-limit.util';

describe('auth-rate-limit.util (H-02)', () => {
  it('is enabled by default', () => {
    expect(isAuthRateLimitEnabled('true')).toBe(true);
    expect(isAuthRateLimitEnabled(undefined)).toBe(true);
  });

  it('can be disabled', () => {
    expect(isAuthRateLimitEnabled('false')).toBe(false);
    expect(isAuthRateLimitEnabled('0')).toBe(false);
  });

  it('builds stable keys with email', () => {
    expect(authRateLimitKey('login', '1.2.3.4', 'User@Mail.com')).toBe(
      'login:1.2.3.4:user@mail.com',
    );
  });
});
