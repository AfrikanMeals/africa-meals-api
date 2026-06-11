import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';

const BASIC_REALM = 'Google Merchant Feed';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function readGoogleMerchantBasicAuthCredentials(config: ConfigService): {
  user: string;
  password: string;
} | null {
  const user = config.get<string>('GOOGLE_MERCHANT_BASIC_AUTH_USER')?.trim();
  const password = config
    .get<string>('GOOGLE_MERCHANT_BASIC_AUTH_PASSWORD')
    ?.trim();
  if (!user || !password) return null;
  return { user, password };
}

export function verifyGoogleMerchantBasicAuthHeader(
  authorization: string | undefined,
  expectedUser: string,
  expectedPassword: string,
): boolean {
  if (!authorization?.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(
      authorization.slice(6).trim(),
      'base64',
    ).toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return false;
    const user = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    return (
      safeEqual(user, expectedUser) && safeEqual(password, expectedPassword)
    );
  } catch {
    return false;
  }
}

/** Returns false after sending HTTP 401 (for Google Merchant Center credential prompt). */
export function assertGoogleMerchantBasicAuth(
  req: Request,
  res: Response,
  config: ConfigService,
): boolean {
  const credentials = readGoogleMerchantBasicAuthCredentials(config);
  if (!credentials) {
    res.setHeader('WWW-Authenticate', `Basic realm="${BASIC_REALM}"`);
    res.status(503).type('text/plain').send('google_merchant_basic_auth_not_configured');
    return false;
  }

  if (
    !verifyGoogleMerchantBasicAuthHeader(
      req.headers.authorization,
      credentials.user,
      credentials.password,
    )
  ) {
    res.setHeader('WWW-Authenticate', `Basic realm="${BASIC_REALM}"`);
    res.status(401).type('text/plain').send('Unauthorized');
    return false;
  }

  return true;
}
