import {
  sendNestHttpText,
  setNestHttpHeader,
  type NestHttpResponse,
} from '@common/http/http-response.util';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';

const BASIC_REALM = 'Google Merchant Feed';

export type GoogleMerchantBasicAuthCheck =
  | { ok: true; user: string }
  | { ok: false; status: number; reason: string; body: string };

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

export function checkGoogleMerchantBasicAuth(
  req: Request,
  config: ConfigService,
): GoogleMerchantBasicAuthCheck {
  const credentials = readGoogleMerchantBasicAuthCredentials(config);
  if (!credentials) {
    return {
      ok: false as const,
      status: 503,
      reason: 'basic_auth_not_configured',
      body: 'google_merchant_basic_auth_not_configured',
    };
  }

  const authorization = req.headers.authorization;
  if (!authorization) {
    return {
      ok: false as const,
      status: 401,
      reason: 'missing_authorization_header',
      body: 'Unauthorized',
    };
  }
  if (!authorization.startsWith('Basic ')) {
    return {
      ok: false as const,
      status: 401,
      reason: 'invalid_authorization_scheme',
      body: 'Unauthorized',
    };
  }

  if (
    !verifyGoogleMerchantBasicAuthHeader(
      authorization,
      credentials.user,
      credentials.password,
    )
  ) {
    return {
      ok: false as const,
      status: 401,
      reason: 'invalid_credentials',
      body: 'Unauthorized',
    };
  }

  return { ok: true as const, user: credentials.user };
}

/** Returns false after sending HTTP 401/503 (for Google Merchant Center credential prompt). */
export function assertGoogleMerchantBasicAuth(
  req: Request,
  res: NestHttpResponse,
  config: ConfigService,
): boolean {
  const check = checkGoogleMerchantBasicAuth(req, config);
  if (check.ok === false) {
    // FastifyReply n’a pas setHeader : WWW-Authenticate via helper Nest/Fastify.
    setNestHttpHeader(
      res,
      'WWW-Authenticate',
      `Basic realm="${BASIC_REALM}"`,
    );
    sendNestHttpText(res, check.status, check.body, 'text/plain');
    return false;
  }

  return true;
}
