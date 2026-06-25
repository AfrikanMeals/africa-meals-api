import { Injectable, Logger } from '@nestjs/common';
import type { Express } from 'express';

const IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

@Injectable()
export class ImageCompressionService {
  private readonly logger = new Logger(ImageCompressionService.name);

  isImageMime(mime: string): boolean {
    const m = (mime || '').toLowerCase();
    return IMAGE_MIMES.has(m) || m.startsWith('image/');
  }

  async compressIfImage(file: Express.Multer.File): Promise<Express.Multer.File> {
    if (!file?.buffer?.length || !this.isImageMime(file.mimetype)) {
      return file;
    }
    try {
      const sharp = (await import('sharp')).default;
      const meta = await sharp(file.buffer, { failOn: 'none' }).metadata();
      const hasAlpha = meta.hasAlpha === true;

      const pipeline = sharp(file.buffer, { failOn: 'none' })
        .rotate()
        .resize({
          width: 2048,
          height: 2048,
          fit: 'inside',
          withoutEnlargement: true,
        });

      const base = file.originalname.replace(/\.[^.]+$/, '') || 'image';
      let output: Buffer;
      let mimetype: string;
      let originalname: string;

      if (hasAlpha) {
        // JPEG flattening turns alpha into black — keep transparency (WebP).
        output = await pipeline
          .webp({ quality: 85, alphaQuality: 100, effort: 4 })
          .toBuffer();
        mimetype = 'image/webp';
        originalname = `${base}.webp`;
      } else {
        output = await pipeline
          .jpeg({ quality: 82, mozjpeg: true })
          .toBuffer();
        mimetype = 'image/jpeg';
        originalname = `${base}.jpg`;
      }

      if (!output.length || output.length >= file.buffer.length) {
        return file;
      }

      return {
        ...file,
        buffer: output,
        size: output.length,
        mimetype,
        originalname,
      };
    } catch (err) {
      this.logger.warn(
        `compression skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
      return file;
    }
  }
}
