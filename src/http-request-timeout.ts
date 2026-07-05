import {
  middlewareHeadersSent,
  sendMiddlewareJson,
  type MiddlewareResponse,
} from '@common/http/http-response.util';
import type { NextFunction, Request } from 'express';
import type { Server } from 'http';

const DEFAULT_MS = 60_000;

function parseTimeoutMs(): number {
  const raw = process.env.HTTP_REQUEST_TIMEOUT_MS;
  if (raw == null || raw.trim() === '') return DEFAULT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_MS;
}

/**
 * Durée max (réception + traitement) pour une requête HTTP.
 * Défaut 1 min ; surcharge avec `HTTP_REQUEST_TIMEOUT_MS`.
 */
export function getHttpRequestTimeoutMs(): number {
  return parseTimeoutMs();
}

/**
 * Limites côté Node pour la réception de la requête (en-têtes + corps).
 * `headersTimeout` doit rester un peu au-dessus de `requestTimeout`.
 */
export function applyHttpServerTimeouts(httpServer: Server): void {
  const ms = getHttpRequestTimeoutMs();
  httpServer.requestTimeout = ms;
  httpServer.headersTimeout = ms + 5_000;
  httpServer.timeout = ms + 10_000;
}

/**
 * Coupe les requêtes dont le traitement (handler Nest) dépasse la limite.
 */
export function httpRequestTimeoutMiddleware() {
  const ms = getHttpRequestTimeoutMs();
  return (req: Request, res: MiddlewareResponse, next: NextFunction) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (!middlewareHeadersSent(res)) {
        sendMiddlewareJson(res, 504, {
          statusCode: 504,
          message: 'Request timeout',
        });
      } else {
        req.socket?.destroy();
      }
    }, ms);

    const onDone = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
    };

    res.once('finish', onDone);
    res.once('close', onDone);
    next();
  };
}
