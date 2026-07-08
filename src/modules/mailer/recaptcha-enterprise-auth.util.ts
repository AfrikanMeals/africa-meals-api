import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ConfigService } from '@nestjs/config';
import { GoogleAuth, GoogleAuthOptions } from 'google-auth-library';

const RECAPTCHA_SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];

function parseServiceAccountJson(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

function readServiceAccountFile(pathEnv: string): Record<string, unknown> {
  const absolutePath = resolve(process.cwd(), pathEnv.trim());
  return parseServiceAccountJson(readFileSync(absolutePath, 'utf8'));
}

/**
 * Credentials dédiés reCAPTCHA Enterprise (projet wise-eat-com).
 * Indépendant de GOOGLE_APPLICATION_CREDENTIALS / Firebase (wise-eat-com, FCM).
 */
export function resolveRecaptchaGoogleAuthOptions(
  config: ConfigService,
): GoogleAuthOptions {
  const inline = config
    .get<string>('RECAPTCHA_ENTERPRISE_SERVICE_ACCOUNT_JSON')
    ?.trim();
  if (inline) {
    return {
      credentials: parseServiceAccountJson(inline),
      scopes: RECAPTCHA_SCOPES,
    };
  }

  const pathEnv = config
    .get<string>('RECAPTCHA_ENTERPRISE_SERVICE_ACCOUNT_PATH')
    ?.trim();
  if (pathEnv) {
    return {
      credentials: readServiceAccountFile(pathEnv),
      scopes: RECAPTCHA_SCOPES,
    };
  }

  return { scopes: RECAPTCHA_SCOPES };
}

export function createRecaptchaGoogleAuth(config: ConfigService): GoogleAuth {
  return new GoogleAuth(resolveRecaptchaGoogleAuthOptions(config));
}
