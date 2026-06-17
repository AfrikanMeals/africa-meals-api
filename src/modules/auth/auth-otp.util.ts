import {
  compareOtpBcrypt,
  hashOtpBcrypt,
} from '@common/crypto/password-hash.util';
import { randomBytes } from 'crypto';

const OTP_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function generateOtpCode(length = 6): string {
  const bytes = randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += OTP_ALPHABET[bytes[i] % OTP_ALPHABET.length];
  }
  return result;
}

export function normalizeOtpCode(code: string): string {
  return code.trim().toUpperCase();
}

export function isBcryptHash(value: string): boolean {
  return /^\$2[aby]\$\d{2}\$/.test(value);
}

export async function hashOtpCode(code: string): Promise<string> {
  return hashOtpBcrypt(normalizeOtpCode(code));
}

export async function verifyOtpCode(
  code: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  const normalized = normalizeOtpCode(code);
  if (isBcryptHash(stored)) {
    return compareOtpBcrypt(normalized, stored);
  }
  return normalizeOtpCode(stored) === normalized;
}

export function otpExpiresAt(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

export function isOtpExpired(expiresAt: Date | null | undefined): boolean {
  if (!expiresAt) return false;
  return expiresAt.getTime() < Date.now();
}

export async function issueOtpCode(
  length = 6,
  ttlMinutes = 15,
): Promise<{ code: string; hash: string; expiresAt: Date }> {
  const code = generateOtpCode(length);
  const hash = await hashOtpCode(code);
  return { code, hash, expiresAt: otpExpiresAt(ttlMinutes) };
}
