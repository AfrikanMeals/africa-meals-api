import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { UserModel } from '@schemas/user.schema';
import { defer, Observable, switchMap } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { extractStoreIdFromRequest } from '../request-stats/request-stats.util';
import { DashboardAuditResourceResolver } from './dashboard-audit-resource.resolver';
import { DashboardAuditService } from './dashboard-audit.service';
import {
  dashboardPathFromRequest,
  isDashboardWebClient,
  normalizeDashboardApiPath,
  shouldSkipDashboardAuditHttpPath,
} from './dashboard-audit.util';

@Injectable()
export class DashboardAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly audit: DashboardAuditService,
    private readonly resourceResolver: DashboardAuditResourceResolver,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const path = req.path ?? req.url ?? '';

    if (
      !isDashboardWebClient(req) ||
      shouldSkipDashboardAuditHttpPath(path) ||
      !req.user
    ) {
      return next.handle();
    }

    const user = req.user as UserModel;
    const method = (req.method ?? 'GET').toUpperCase();
    const apiPath = normalizeDashboardApiPath(path);
    const dashboardPath = dashboardPathFromRequest(req);
    const storeId = extractStoreIdFromRequest(req);

    return defer(() =>
      this.resourceResolver.resolveBefore(req, apiPath, method),
    ).pipe(
      switchMap((resourceHint) =>
        next.handle().pipe(
          tap({
            next: (responseBody) => {
              const hint = this.resourceResolver.enrichFromResponse(
                resourceHint,
                responseBody,
                method,
              );
              this.audit.recordHttpEvent(user, {
                method,
                apiPath,
                dashboardPath,
                storeId,
                status: res.statusCode,
                userAgent: req.headers['user-agent'],
                ip: clientIp(req),
                resource: hint.resource,
                resourceId: hint.resourceId,
                resourceName: hint.resourceName,
              });
            },
          }),
        ),
      ),
    );
  }
}

function clientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim();
  }
  return req.ip;
}
