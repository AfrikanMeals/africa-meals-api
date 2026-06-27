import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { getAppCheck } from 'firebase-admin/app-check';
import type { App } from 'firebase-admin/app';

export const APP_CHECK_HEADER = 'x-firebase-appcheck';

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
}
