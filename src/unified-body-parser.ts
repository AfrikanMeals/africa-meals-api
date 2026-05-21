import type { IncomingMessage } from 'http';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
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
  const limit = options?.limit ?? '60mb';
  const preserveRawBody = options?.preserveRawBody ?? true;

  const jsonParser = express.json({
    limit,
    type: (req) => !hasCompressedContentEncoding(req),
    verify: preserveRawBody
      ? (req: RequestWithRawBody, _res, buf) => {
          req.rawBody = Buffer.from(buf);
        }
      : undefined,
  });

  return (req: RequestWithRawBody, res: Response, next: NextFunction) => {
    if (!hasCompressedContentEncoding(req)) {
      return jsonParser(req, res, next);
    }

    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks);
        const encoding = String(req.headers['content-encoding'] || '').toLowerCase();
        const decoded =
          encoding.includes('gzip')
            ? zlib.gunzipSync(raw)
            : zlib.inflateSync(raw);
        if (preserveRawBody) {
          req.rawBody = decoded;
        }
        delete req.headers['content-encoding'];
        const text = decoded.toString('utf8').trim();
        req.body = text.length > 0 ? JSON.parse(text) : {};
        next();
      } catch {
        res.status(400).json({ message: 'invalid_compressed_body' });
      }
    });
    req.on('error', (err) => next(err));
  };
}

function hasCompressedContentEncoding(req: IncomingMessage): boolean {
  const enc = String(req.headers['content-encoding'] || '').toLowerCase();
  return enc.includes('gzip') || enc.includes('deflate');
}
