import {
  buildFieldProjectionCacheKey,
  shouldUseFieldProjectionCache,
  type FieldSelectionSpec,
} from '@africa-meals/field-selection';
import { ModuleCacheLayerService } from '@common/cache/module-cache-layer.service';
import { fieldProjectionCacheTtlMs } from '@common/redis-app-cache';
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { lastValueFrom } from 'rxjs';
import type { Request } from 'express';
import { FIELD_SELECTION_REQUEST_PROP } from './field-selection.types';
import { isFieldProjectionCacheRoute } from './field-projection-cache.routes';
import {
  hasFieldSelection,
  parseFieldSelectionFromQuery,
} from './field-selection.util';

type ReqWithSelection = Request & {
  [FIELD_SELECTION_REQUEST_PROP]?: FieldSelectionSpec;
};

let fieldProjectionCacheEnabled = true;

export function setFieldProjectionCacheEnabled(enabled: boolean): void {
  fieldProjectionCacheEnabled = Boolean(enabled);
}

export function isFieldProjectionCacheEnabled(): boolean {
  return fieldProjectionCacheEnabled;
}

@Injectable()
export class FieldProjectionCacheInterceptor implements NestInterceptor {
  constructor(private readonly _cacheLayer: ModuleCacheLayerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<ReqWithSelection>();
    if (req.method !== 'GET') {
      return next.handle();
    }

    const pathOnly = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';
    if (!isFieldProjectionCacheRoute(pathOnly)) {
      return next.handle();
    }

    if (!fieldProjectionCacheEnabled) {
      return next.handle();
    }

    const spec =
      req[FIELD_SELECTION_REQUEST_PROP] ??
      parseFieldSelectionFromQuery(req.query as Record<string, unknown>);

    if (!hasFieldSelection(spec) || !shouldUseFieldProjectionCache(spec)) {
      return next.handle();
    }

    const cacheKey = buildFieldProjectionCacheKey({
      method: 'GET',
      path: pathOnly,
      query: req.query as Record<string, unknown>,
      spec,
    });
    const ttlMs = fieldProjectionCacheTtlMs();

    return from(
      this._cacheLayer
        .getOrSet('fieldProjection', cacheKey, ttlMs, () =>
          lastValueFrom(next.handle()),
        )
        .catch(() => lastValueFrom(next.handle())),
    ).pipe(mergeMap((data) => from(Promise.resolve(data))));
  }
}
