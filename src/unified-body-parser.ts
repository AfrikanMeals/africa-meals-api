import type { IncomingMessage } from 'http';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import getRawBody from 'raw-body';
import zlib from 'zlib';

type RequestWithRawBody = Request & { rawBody?: Buffer };

/**
 * Parse JSON / urlencoded ; décompresse les corps entrants `Content-Encoding: gzip|deflate`
 * (clients mobiles avec compression des requêtes).
 */
export function unifiedJsonBodyParser(options?: {
  limit?: string;
  preserveRawBody?: boolean;
}): express.RequestHandler {
  const limit = options?.limit ?? '5mb';
  const preserveRawBody = options?.preserveRawBody ?? true;

  const jsonParser = express.json({
    limit,
    type: (req) => shouldParseJsonBody(req),
    verify: preserveRawBody
      ? (req: RequestWithRawBody, _res, buf) => {
          req.rawBody = Buffer.from(buf);
        }
      : undefined,
  });

  return (req: RequestWithRawBody, res: Response, next: NextFunction) => {
    if (!hasRequestBody(req)) {
      return next();
    }

    if (!hasCompressedContentEncoding(req)) {
      if (!shouldParseJsonBody(req)) {
        return next();
      }
      return jsonParser(req, res, next);
    }

    void readCompressedJsonBody(req, res, next, { limit, preserveRawBody });
  };
}

async function readCompressedJsonBody(
  req: RequestWithRawBody,
  res: Response,
  next: NextFunction,
  options: { limit: string; preserveRawBody: boolean },
): Promise<void> {
  try {
    const raw = await getRawBody(req, {
      length: req.headers['content-length'],
      limit: options.limit,
    });
    const encoding = String(req.headers['content-encoding'] || '').toLowerCase();
    const decoded = encoding.includes('gzip')
      ? zlib.gunzipSync(raw)
      : zlib.inflateSync(raw);
    if (options.preserveRawBody) {
      req.rawBody = decoded;
    }
    delete req.headers['content-encoding'];
    const text = decoded.toString('utf8').trim();
    req.body = text.length > 0 ? JSON.parse(text) : {};
    next();
  } catch (err) {
    if (isClientAbortedError(err)) {
      return;
    }
    const msg =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : String(err);
    if (/stream is not readable|request aborted/i.test(msg)) {
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ message: 'invalid_compressed_body' });
      return;
    }
    next(err);
  }
}

export function hasRequestBody(req: IncomingMessage): boolean {
  const method = (req.method || 'GET').toUpperCase();
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

export function shouldParseJsonBody(req: IncomingMessage): boolean {
  if (!hasRequestBody(req) || hasCompressedContentEncoding(req)) {
    return false;
  }
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (!ct) {
    return false;
  }
  return ct.includes('application/json') || ct.includes('+json');
}

function isClientAbortedError(err: unknown): boolean {
  const msg =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err);
  return /aborted|ECONNRESET|socket hang up/i.test(msg);
}

function hasCompressedContentEncoding(req: IncomingMessage): boolean {
  const enc = String(req.headers['content-encoding'] || '').toLowerCase();
  return enc.includes('gzip') || enc.includes('deflate');
}
