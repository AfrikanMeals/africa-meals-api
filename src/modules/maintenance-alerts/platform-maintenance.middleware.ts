import {
  sendNestHttpJson,
  type NestHttpResponse,
} from '@common/http/http-response.util';
import {
  Injectable,
  Logger,
  NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request } from 'express';
import { PlatformMaintenanceSseService } from './platform-maintenance-sse.service';
import { PlatformMaintenanceService } from './platform-maintenance.service';
import {
  isAdminJwtRequest,
  isAdminWebDashboardRequest,
  isMobileClientRequest,
  isPlatformMaintenanceWhitelisted,
  maintenanceEntryForMode,
  normalizeApiPath,
  readMobileAppUiMode,
} from './platform-maintenance.middleware.util';

@Injectable()
export class PlatformMaintenanceMiddleware implements NestMiddleware {
  private readonly logger = new Logger(PlatformMaintenanceMiddleware.name);

  constructor(
    private readonly platformMaintenance: PlatformMaintenanceService,
    private readonly maintenanceSse: PlatformMaintenanceSseService,
  ) {}

  async use(req: Request, res: NestHttpResponse, next: NextFunction): Promise<void> {
    if (!isMobileClientRequest(req)) {
      next();
      return;
    }

    const path = normalizeApiPath(req.originalUrl ?? req.url ?? '');
    if (isPlatformMaintenanceWhitelisted(path)) {
      next();
      return;
    }

    if (isAdminJwtRequest(req) || isAdminWebDashboardRequest(req)) {
      next();
      return;
    }

    const mode = readMobileAppUiMode(req.headers['x-app-ui-mode']);
    const snapshot =
      this.maintenanceSse.lastSnapshot() ??
      (await this.platformMaintenance.getPublicStatus());
    const entry = maintenanceEntryForMode(snapshot, mode);
    if (!entry.enabled) {
      next();
      return;
    }

    const message =
      String(entry.message ?? '').trim() ||
      'This platform is temporarily unavailable for maintenance.';
    this.logger.debug(`Blocked mobile ${mode} request ${req.method} ${path}`);
    sendNestHttpJson(res, 503, {
      statusCode: 503,
      code: 'platform_maintenance',
      message,
      platform: mode,
    });
  }
}
