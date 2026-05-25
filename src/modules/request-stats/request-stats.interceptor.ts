import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';
import { RequestStatsStore } from './request-stats.store';
import {
  extractStoreIdFromRequest,
  isRequestStatsEnabled,
  normalizeRequestRoute,
  shouldSkipRequestStatsPath,
} from './request-stats.util';

@Injectable()
export class RequestStatsInterceptor implements NestInterceptor {
  private enabled = true;

  constructor(
    private readonly store: RequestStatsStore,
    private readonly config: ConfigService,
  ) {
    this.enabled = isRequestStatsEnabled(
      this.config.get<string>('REQUEST_STATS_ENABLED'),
    );
    this.store.configure(
      Number(this.config.get('REQUEST_STATS_MAX_ENTRIES')) || 10_000,
    );
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.enabled || context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const path = req.path ?? req.url ?? '';
    if (shouldSkipRequestStatsPath(path)) {
      return next.handle();
    }

    const started = Date.now();
    const method = (req.method ?? 'GET').toUpperCase();
    const route = normalizeRequestRoute(path);
    const storeId = extractStoreIdFromRequest(req);
    const user = req.user as { _id?: { toString(): string } } | undefined;
    const userId = user?._id?.toString?.() ?? null;

    return next.handle().pipe(
      tap({
        next: () => this.record(req, res, started, method, route, storeId, userId),
        error: () => this.record(req, res, started, method, route, storeId, userId),
      }),
    );
  }

  private record(
    req: Request,
    res: Response,
    started: number,
    method: string,
    route: string,
    storeId: string | null,
    userId: string | null,
  ): void {
    const statusCode =
      typeof res.statusCode === 'number' ? res.statusCode : null;
    this.store.push({
      kind: 'http',
      method,
      route,
      storeId,
      statusCode,
      durationMs: Math.max(0, Date.now() - started),
      userId,
      source: 'api',
    });
  }
}
