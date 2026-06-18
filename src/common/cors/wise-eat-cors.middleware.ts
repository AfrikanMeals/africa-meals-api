import type { NextFunction, Request, Response } from 'express';
import {
  buildApiCorsOptions,
  isBrowserCorsOriginAllowed,
} from './cors-options';

const CORS_METHODS = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS';

/**
 * CORS précoce : garantit les en-têtes sur OPTIONS et réponses d’erreur (403 App Check, etc.).
 * Toujours actif pour `*.wise-eat.com` via `isBrowserCorsOriginAllowed`.
 */
export function wiseEatCorsEarlyMiddleware() {
  const opts = buildApiCorsOptions();
  const allowedHeaders = (opts.allowedHeaders as string[] | undefined)?.join(',') ?? '';

  return (req: Request, res: Response, next: NextFunction): void => {
    const origin =
      typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
    const allowed = origin ? isBrowserCorsOriginAllowed(origin) : false;

    if (allowed && origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }

    if (req.method === 'OPTIONS') {
      if (allowed) {
        res.setHeader('Access-Control-Allow-Methods', CORS_METHODS);
        if (allowedHeaders) {
          res.setHeader('Access-Control-Allow-Headers', allowedHeaders);
        }
        res.setHeader('Access-Control-Max-Age', '86400');
      }
      res.status(204).end();
      return;
    }

    next();
  };
}
