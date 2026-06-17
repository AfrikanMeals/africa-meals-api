import * as bcrypt from 'bcrypt';

/** Coût bcrypt pour mots de passe utilisateur (L-01). */
export const PASSWORD_BCRYPT_ROUNDS = 12;

/** Coût bcrypt pour codes OTP éphémères. */
export const OTP_BCRYPT_ROUNDS = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, PASSWORD_BCRYPT_ROUNDS);
}

export async function comparePassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function hashOtpBcrypt(plain: string): Promise<string> {
  return bcrypt.hash(plain, OTP_BCRYPT_ROUNDS);
}

export async function compareOtpBcrypt(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
