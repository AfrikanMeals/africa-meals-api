import {
  sendMiddlewareJson,
  sendMiddlewareStatus,
  type MiddlewareResponse,
} from '@common/http/http-response.util';
import type { NextFunction, Request } from 'express';
import {
  buildDryRunSimulatedResponse,
  DRY_RUN_MODE_HEADER,
  isDryRunRequest,
  readDryRunConfig,
  shouldSimulateDryRunMutation,
} from './dry-run.util';
import { normalizeRequestPath } from '../rate-limit/rate-limit.util';

/**
 * Mode dry run (prod load test) : GET/HEAD passent ; POST/PUT/PATCH/DELETE simulés.
 * Activation : DRY_RUN_ENABLED + DRY_RUN_SECRET + headers X-Wise-Eat-Dry-Run + token.
 */
export function httpDryRunMiddleware(cfg = readDryRunConfig()) {
  return (req: Request, res: MiddlewareResponse, next: NextFunction): void => {
    if (!isDryRunRequest(req, cfg)) {
      next();
      return;
    }

    const path = normalizeRequestPath(req);
    const method = String(req.method ?? 'GET').toUpperCase();

    if (shouldSimulateDryRunMutation(req, path, method)) {
      const { status, body } = buildDryRunSimulatedResponse(method, path);
      res.setHeader(DRY_RUN_MODE_HEADER, 'simulated');
      if (body) {
        sendMiddlewareJson(res, status, body);
        return;
      }
      sendMiddlewareStatus(res, status);
      return;
    }

    res.setHeader(DRY_RUN_MODE_HEADER, 'pass-through');
    next();
  };
}
