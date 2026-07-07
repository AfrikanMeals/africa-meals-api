import type { NextFunction, Request, Response } from 'express';
import {
  DEFAULT_JSON_BODY_LIMIT,
  UPLOAD_JSON_BODY_LIMIT,
} from '@common/http/body-parser-limits.util';
import { unifiedJsonBodyParser } from './unified-body-parser';

const LARGE_JSON_BODY_PATH_SUFFIXES = [
  '/chat-voice-json',
  '/chat-media-json',
  '/profile-image-json',
  '/product-json',
  '/drinks-json',
  '/section-image-json',
  '/image-json',
  '/customer-absent/submit',
  '/customer-absent/submit-json',
] as const;

const LARGE_JSON_BODY_PATH_REGEXES = [
  /\/stores\/[^/]+\/products\/[^/]+\/json$/i,
  /\/stores\/[^/]+\/drinks\/[^/]+\/json$/i,
] as const;

export function isLargeJsonBodyPath(req: Request): boolean {
  const path = (req.originalUrl || req.url || '').split('?')[0] || '';
  const normalized = path.toLowerCase();
  if (
    LARGE_JSON_BODY_PATH_SUFFIXES.some((suffix) => normalized.includes(suffix))
  ) {
    return true;
  }
  return LARGE_JSON_BODY_PATH_REGEXES.some((re) => re.test(normalized));
}

export function createRouteAwareJsonBodyParser(options?: {
  preserveRawBody?: boolean;
}): (
  req: Request,
  res: Response,
  next: NextFunction,
) => void {
  const preserveRawBody = options?.preserveRawBody ?? true;
  const defaultParser = unifiedJsonBodyParser({
    limit: DEFAULT_JSON_BODY_LIMIT,
    preserveRawBody,
  });
  const uploadParser = unifiedJsonBodyParser({
    limit: UPLOAD_JSON_BODY_LIMIT,
    preserveRawBody,
  });

  return (req, res, next) => {
    const parser = isLargeJsonBodyPath(req) ? uploadParser : defaultParser;
    return parser(req, res, next);
  };
}
