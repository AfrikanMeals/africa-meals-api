import {
  redactSensitiveJsonForLog,
  redactSensitiveObject,
} from './redact-sensitive.util';

describe('redact-sensitive.util', () => {
  it('redacts password and OTP fields', () => {
    const out = redactSensitiveObject({
      email: 'a@b.com',
      password: 'secret',
      code: 'ABC123',
    }) as Record<string, unknown>;
    expect(out.email).toBe('a@b.com');
    expect(out.password).toBe('[REDACTED]');
    expect(out.code).toBe('[REDACTED]');
  });

  it('serializes redacted payloads for logs', () => {
    const json = redactSensitiveJsonForLog({
      refreshToken: 'rt',
      nested: { authToken: 'at' },
    });
    expect(json).toContain('[REDACTED]');
    expect(json).not.toContain('rt');
    expect(json).not.toContain('at');
  });
});
