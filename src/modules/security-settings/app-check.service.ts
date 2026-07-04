import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { getAppCheck } from 'firebase-admin/app-check';
import type { App } from 'firebase-admin/app';

export const APP_CHECK_HEADER = 'x-firebase-appcheck';

/** Firebase Admin : TTL min 30 min, max 7 jours (pas de TTL 1 mois côté Firebase). */
export const APP_CHECK_TOKEN_TTL_MIN_MS = 30 * 60 * 1000;
export const APP_CHECK_TOKEN_TTL_MAX_MS = 7 * 24 * 60 * 60 * 1000;
/** Défaut = max Firebase (session longue, moins d’échanges debug / minting). */
export const APP_CHECK_TOKEN_TTL_DEFAULT_MS = APP_CHECK_TOKEN_TTL_MAX_MS;

export type AppCheckReleaseTokenResult = {
  token: string;
  ttlMillis: number;
  expiresAt: string;
};

@Injectable()
export class AppCheckService {
  private readonly logger = new Logger(AppCheckService.name);

  constructor(
    @Optional() @Inject('FIREBASE_ADMIN') private readonly firebaseApp: App | null,
  ) {}

  async verifyRequestToken(token: string | undefined): Promise<void> {
    if (!this.firebaseApp) {
      this.logger.warn('App Check ignoré — Firebase Admin absent');
      return;
    }
    const trimmed = token?.trim() ?? '';
    if (!trimmed) {
      throw new ForbiddenException('app_check_token_missing');
    }
    try {
      await getAppCheck(this.firebaseApp).verifyToken(trimmed);
    } catch (err) {
      this.logger.warn(
        `App Check token invalid: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ForbiddenException('app_check_invalid');
    }
  }

  /**
   * Mint un jeton App Check custom (mode release / tests) pour un appId Firebase.
   * À utiliser uniquement côté admin — le jeton est accepté par verifyToken.
   */
  async createReleaseToken(
    appId: string,
    ttlMillis: number = APP_CHECK_TOKEN_TTL_DEFAULT_MS,
  ): Promise<AppCheckReleaseTokenResult> {
    if (!this.firebaseApp) {
      throw new ServiceUnavailableException('firebase_admin_unavailable');
    }
    const id = appId.trim();
    if (!id) {
      throw new ForbiddenException('app_check_app_id_missing');
    }
    const ttl = Math.min(
      APP_CHECK_TOKEN_TTL_MAX_MS,
      Math.max(APP_CHECK_TOKEN_TTL_MIN_MS, Math.floor(ttlMillis)),
    );
    try {
      const result = await getAppCheck(this.firebaseApp).createToken(id, {
        ttlMillis: ttl,
      });
      const expiresAt = new Date(Date.now() + result.ttlMillis).toISOString();
      this.logger.log(
        `App Check release token minté pour ${id} (ttl=${result.ttlMillis}ms)`,
      );
      return {
        token: result.token,
        ttlMillis: result.ttlMillis,
        expiresAt,
      };
    } catch (err) {
      this.logger.warn(
        `App Check createToken failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new ServiceUnavailableException('app_check_token_mint_failed');
    }
  }
}
