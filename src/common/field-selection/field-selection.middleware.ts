import type { NextFunction, Request, Response } from 'express';
import { parseFieldSelectionFromQuery } from './field-selection.util';
import type { FieldSelectionSpec } from './field-selection.types';
import { FIELD_SELECTION_REQUEST_PROP } from './field-selection.types';

type ReqWithSelection = Request & {
  [FIELD_SELECTION_REQUEST_PROP]?: FieldSelectionSpec;
};

/**
 * Attache `includeFields` / `excludeField(s)` (query) à la requête pour l’intercepteur.
 * Le filtrage réel du JSON est fait dans {@link ResponseFieldFilterInterceptor}.
 */
export function fieldSelectionMiddleware() {
  return (req: Request, _res: Response, next: NextFunction) => {
    const r = req as ReqWithSelection;
    r[FIELD_SELECTION_REQUEST_PROP] = parseFieldSelectionFromQuery(
      req.query as Record<string, unknown>,
    );
    next();
  };
}
