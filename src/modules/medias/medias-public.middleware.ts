import {
  Injectable,
  NestMiddleware,
  NotFoundException,
} from '@nestjs/common';
import type { NextFunction, Request } from 'express';
import type { ServerResponse } from 'http';
import {
  middlewareHeadersSent,
  sendMiddlewareJson,
  type MiddlewareResponse,
} from '@common/http/http-response.util';
import { MediasService } from './medias.service';

function extractMediaPublicObjectPath(
  originalUrl: string | undefined,
): string | null {
  const raw = String(originalUrl ?? '').split('?')[0];
  const match = raw.match(/\/medias\/public\/(.+)$/i);
  if (!match?.[1]?.trim()) return null;
  return decodeURIComponent(match[1].trim());
}

/**
 * Cible d’écriture Node pour `stream.pipe` — Fastify middie expose
 * `ServerResponse` (pas Express `res.type` / `res.json`).
 */
function middlewareWritable(res: MiddlewareResponse): ServerResponse {
  const raw = (res as { raw?: ServerResponse }).raw;
  if (raw && typeof raw.write === 'function') return raw;
  return res as ServerResponse;
}

/** Intercepte GET /medias/public/… avant le routeur (chemins multi-segments). */
@Injectable()
export class MediasPublicProxyMiddleware implements NestMiddleware {
  constructor(private readonly mediasService: MediasService) {}

  async use(
    req: Request,
    res: MiddlewareResponse,
    next: NextFunction,
  ): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }

    const objectPath = extractMediaPublicObjectPath(
      req.originalUrl ?? req.url,
    );
    if (!objectPath) {
      next();
      return;
    }

    try {
      const { body, contentType } =
        await this.mediasService.streamPublicObject(objectPath);
      // Fastify : pas de res.type() Express — Content-Type via setHeader.
      const writable = middlewareWritable(res);
      if (!middlewareHeadersSent(res) && !writable.headersSent) {
        writable.setHeader(
          'Cache-Control',
          'public, max-age=31536000, immutable',
        );
        if (contentType) {
          writable.setHeader('Content-Type', contentType);
        }
      }
      if (req.method === 'HEAD') {
        writable.end();
        return;
      }
      body.on('error', () => {
        if (!writable.headersSent) {
          sendMiddlewareJson(res, 404, {
            statusCode: 404,
            message: 'media_not_found',
            error: 'Not Found',
          });
        } else {
          writable.destroy();
        }
      });
      body.pipe(writable);
    } catch (err) {
      // Fix: sous Fastify, res.status().json() n’existe pas → TypeError 500
      // masquait même les NotFoundException du proxy.
      if (err instanceof NotFoundException) {
        sendMiddlewareJson(res, 404, {
          statusCode: 404,
          message: err.message ?? 'media_not_found',
          error: 'Not Found',
        });
        return;
      }
      next(err);
    }
  }
}
