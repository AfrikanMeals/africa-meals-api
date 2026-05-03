import type { NextFunction, Request, Response } from 'express';

type CompressionOptions = { threshold?: number };

/**
 * Middleware `compression` en import CJS-compatible.
 * Sous Firebase Functions, `import compression from 'compression'` peut compiler en
 * `compression_1.default` alors que le paquet n’expose pas de `default` → runtime error.
 */
export function compressionMiddleware(
  options?: CompressionOptions,
): (req: Request, res: Response, next: NextFunction) => void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const compression = require('compression') as (
    opts?: CompressionOptions,
  ) => (req: Request, res: Response, next: NextFunction) => void;
  return compression(options);
}
