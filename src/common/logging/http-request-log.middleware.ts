import { redactSensitiveJsonForLog } from './redact-sensitive.util';
import { isAcmeChallengePath } from '../http/acme-challenge.middleware';
import {
  formatHttpRequestLogLine,
  httpLogEnvironmentLabel,
  isHttpBodyLoggingEnabled,
  isHttpRequestLoggingEnabled,
  shouldUseHttpLogColors,
  writeHttpRequestLog,
} from './http-request-log.util';
import type { NextFunction, Request, Response } from 'express';

function requestBodySuffix(req: Request): string {
  if (!isHttpBodyLoggingEnabled()) return '';
  const ct = req.headers['content-type'];
  const isMultipart =
    typeof ct === 'string' && ct.includes('multipart/form-data');
  const body = isMultipart
    ? '(multipart)'
    : req.body
      ? redactSensitiveJsonForLog(req.body)
      : '(no body)';
  return ` body: ${body}`;
}

function shouldSkipHttpRequestLog(path: string): boolean {
  const p = (path.split('?')[0] ?? path).trim();
  if (!p || p === '/') return true;
  if (p === '/health' || p.startsWith('/health/')) return true;
  if (p === '/wise-eat' || p.startsWith('/wise-eat/')) return true;
  if (p === '/favicon.ico') return true;
  if (isAcmeChallengePath(p)) return true;
  return false;
}

export function httpRequestLogMiddleware() {
  const enabled = isHttpRequestLoggingEnabled();
  const useColors = shouldUseHttpLogColors();
  const environment = httpLogEnvironmentLabel();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!enabled) {
      next();
      return;
    }

    const path = req.originalUrl ?? req.url ?? '';
    if (shouldSkipHttpRequestLog(path)) {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();
    const bodySuffix = requestBodySuffix(req);
    let logged = false;

    const logOnce = (status: number) => {
      if (logged) return;
      logged = true;
      const elapsedNs = process.hrtime.bigint() - startedAt;
      const durationMs = Number(elapsedNs) / 1_000_000;
      const line = formatHttpRequestLogLine({
        method: req.method ?? 'GET',
        url: path,
        status,
        durationMs,
        environment,
        bodySuffix,
        useColors,
      });
      writeHttpRequestLog(line, status);
    };

    res.on('finish', () => {
      logOnce(res.statusCode || 200);
    });

    res.on('close', () => {
      if (!logged) {
        logOnce(res.headersSent ? res.statusCode || 499 : 0);
      }
    });

    next();
  };
}
