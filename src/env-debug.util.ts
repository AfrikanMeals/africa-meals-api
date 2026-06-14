import { timingSafeEqual } from 'crypto';

/**
 * Diagnostic env dump — jamais en production.
 * En dev/staging : `ENABLE_ENV_DEBUG=true` + credentials `ENV_DEBUG_BASIC_*`.
 */
export function isEnvDebugControllerEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  return process.env.ENABLE_ENV_DEBUG === 'true';
}

export function readEnvDebugBasicAuthCredentials(): {
  user: string;
  password: string;
} | null {
  const user = process.env.ENV_DEBUG_BASIC_USER?.trim();
  const password = process.env.ENV_DEBUG_BASIC_PASS?.trim();
  if (!user || !password) {
    return null;
  }
  return { user, password };
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

export function verifyEnvDebugBasicAuthHeader(
  authorization: string | undefined,
  expectedUser: string,
  expectedPassword: string,
): boolean {
  if (!authorization?.startsWith('Basic ')) {
    return false;
  }
  try {
    const decoded = Buffer.from(
      authorization.slice(6).trim(),
      'base64',
    ).toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) {
      return false;
    }
    const user = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    return (
      safeEqual(user, expectedUser) && safeEqual(password, expectedPassword)
    );
  } catch {
    return false;
  }
}
