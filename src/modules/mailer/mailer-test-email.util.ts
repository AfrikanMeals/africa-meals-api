/**
 * Endpoint diagnostic d'envoi e-mail — jamais en production.
 * En dev/staging : `ENABLE_MAILER_TEST_EMAIL=true` + JWT ADMIN.
 */
export function isMailerTestEmailEnabled(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  return process.env.ENABLE_MAILER_TEST_EMAIL === 'true';
}

export const MAILER_TEST_EMAIL_RATE_LIMIT = {
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
} as const;
