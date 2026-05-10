import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { Request } from 'express';
import {
  FIELD_SELECTION_REQUEST_PROP,
  type FieldSelectionSpec,
} from './field-selection.types';
import {
  applyFieldSelection,
  parseFieldSelectionFromQuery,
} from './field-selection.util';

type ReqWithSelection = Request & {
  [FIELD_SELECTION_REQUEST_PROP]?: FieldSelectionSpec;
};

@Injectable()
export class ResponseFieldFilterInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest<ReqWithSelection>();
    const pathOnly = (req.originalUrl ?? req.url ?? '').split('?')[0] ?? '';

    if (pathOnly.includes('/graphql')) {
      return next.handle();
    }

    const spec =
      req[FIELD_SELECTION_REQUEST_PROP] ??
      parseFieldSelectionFromQuery(req.query as Record<string, unknown>);

    if (!spec.includePaths.length && !spec.excludePaths.length) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        if (data === null || data === undefined) {
          return data;
        }
        if (typeof (data as { pipe?: unknown }).pipe === 'function') {
          return data;
        }
        try {
          return applyFieldSelection(data, spec);
        } catch {
          return data;
        }
      }),
    );
  }
}
