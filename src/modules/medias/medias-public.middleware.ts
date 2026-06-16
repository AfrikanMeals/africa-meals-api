import {
  Injectable,
  NestMiddleware,
  NotFoundException,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MediasService } from './medias.service';

function extractMediaPublicObjectPath(
  originalUrl: string | undefined,
): string | null {
  const raw = String(originalUrl ?? '').split('?')[0];
  const match = raw.match(/\/medias\/public\/(.+)$/i);
  if (!match?.[1]?.trim()) return null;
  return decodeURIComponent(match[1].trim());
}

/** Intercepte GET /medias/public/… avant le routeur (chemins multi-segments). */
@Injectable()
export class MediasPublicProxyMiddleware implements NestMiddleware {
  constructor(private readonly mediasService: MediasService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
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
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      if (contentType) {
        res.type(contentType);
      }
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      body.on('error', () => {
        if (!res.headersSent) {
          res.status(404).json({
            statusCode: 404,
            message: 'media_not_found',
            error: 'Not Found',
          });
        } else {
          res.destroy();
        }
      });
      body.pipe(res);
    } catch (err) {
      if (err instanceof NotFoundException) {
        res.status(404).json({
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
