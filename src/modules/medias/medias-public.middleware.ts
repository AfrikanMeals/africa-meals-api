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
 * Si le segment proxy est encore une URL `files.wise-eat.com`, rediriger
 * vers le CDN (évite 404/500 + cache CF d’erreurs).
 */
function filesCdnRedirectTarget(decodedPath: string): string | null {
  const nested = String(decodedPath ?? '').trim();
  if (!nested) return null;
  let candidate = nested;
  if (!/^https?:\/\//i.test(candidate) && /%3A/i.test(candidate)) {
    try {
      candidate = decodeURIComponent(candidate);
    } catch {
      return null;
    }
  }
  try {
    const u = new URL(candidate);
    if (!/^files\.wise-eat\.com$/i.test(u.hostname)) return null;
    const key = u.pathname.replace(/^\/+/, '');
    if (!key || key.includes('..')) return null;
    return `https://files.wise-eat.com/${key
      .split('/')
      .map((s) => encodeURIComponent(s))
      .join('/')}`;
  } catch {
    return null;
  }
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

    // Fix: double-proxy files CDN → 302 vers l’URL publique (pas de proxy SDK).
    const cdnRedirect = filesCdnRedirectTarget(objectPath);
    if (cdnRedirect) {
      const writable = middlewareWritable(res);
      if (!middlewareHeadersSent(res) && !writable.headersSent) {
        writable.statusCode = 302;
        writable.setHeader('Location', cdnRedirect);
        // Ne pas mettre immutable sur une redirection de guérison.
        writable.setHeader('Cache-Control', 'public, max-age=300');
        writable.end();
      }
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
          // Fix: ne jamais laisser Cloudflare cacher une 404 médias en immutable.
          sendMiddlewareJson(
            res,
            404,
            {
              statusCode: 404,
              message: 'media_not_found',
              error: 'Not Found',
            },
            { 'Cache-Control': 'private, no-store' },
          );
        } else {
          writable.destroy();
        }
      });
      body.pipe(writable);
    } catch (err) {
      // Fix: sous Fastify, res.status().json() n’existe pas → TypeError 500
      // masquait même les NotFoundException du proxy.
      if (err instanceof NotFoundException) {
        sendMiddlewareJson(
          res,
          404,
          {
            statusCode: 404,
            message: err.message ?? 'media_not_found',
            error: 'Not Found',
          },
          { 'Cache-Control': 'private, no-store' },
        );
        return;
      }
      next(err);
    }
  }
}
