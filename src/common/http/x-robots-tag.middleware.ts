import type { NextFunction, Request } from 'express';
import type { MiddlewareResponse } from '@common/http/http-response.util';
import {
  API_X_ROBOTS_TAG_HEADER,
  API_X_ROBOTS_TAG_VALUE,
} from './x-robots-tag.util';

/**
 * Marque toutes les réponses API `noindex, nofollow`.
 * Complète `robots.txt` Disallow:/ — les crawlers qui ignorent robots
 * voient quand même X-Robots-Tag. Ne change ni body ni auth.
 */
export function xRobotsTagMiddleware() {
  return (_req: Request, res: MiddlewareResponse, next: NextFunction): void => {
    res.setHeader?.(API_X_ROBOTS_TAG_HEADER, API_X_ROBOTS_TAG_VALUE);
    next();
  };
}
