import { isProductionNodeEnv } from '@modules/auth/jwt-token.util';

/** reCAPTCHA Enterprise — appliqué en prod par défaut (M-07). */
export function isRecaptchaEnterpriseEnforced(): boolean {
  const explicit = process.env.RECAPTCHA_ENTERPRISE_ENFORCE?.trim().toLowerCase();
  if (explicit === 'true') {
    return true;
  }
  if (explicit === 'false') {
    return false;
  }
  return isProductionNodeEnv();
}
