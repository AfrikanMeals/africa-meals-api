import {
  generateOtpCode,
  hashOtpCode,
  isOtpExpired,
  otpExpiresAt,
  verifyOtpCode,
} from './auth-otp.util';

describe('auth-otp.util', () => {
  it('generates uppercase alphanumeric codes', () => {
    const code = generateOtpCode(6);
    expect(code).toMatch(/^[A-Z0-9]{6}$/);
  })

  it('hashes and verifies OTP codes', async () => {
    const code = 'AB12CD';
    const hash = await hashOtpCode(code);
    await expect(verifyOtpCode(code, hash)).resolves.toBe(true);
    await expect(verifyOtpCode('ZZZZZZ', hash)).resolves.toBe(false);
  });

  it('supports legacy plain-text OTP during migration', async () => {
    await expect(verifyOtpCode('abc123', 'ABC123')).resolves.toBe(true);
  });

  it('detects OTP expiry', () => {
    expect(isOtpExpired(otpExpiresAt(-1))).toBe(true);
    expect(isOtpExpired(otpExpiresAt(10))).toBe(false);
    expect(isOtpExpired(undefined)).toBe(false);
  });
});
