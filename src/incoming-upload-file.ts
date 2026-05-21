import { extname } from 'path';
import zlib from 'zlib';
import type { Express } from 'express';

const GZIP_MIMES = new Set(['application/gzip', 'application/x-gzip']);

const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.pdf': 'application/pdf',
};

export function isGzipBuffer(buf: Buffer): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

function mimeFromFilename(filename: string): string {
  const ext = extname(filename).toLowerCase();
  return EXT_TO_MIME[ext] ?? 'application/octet-stream';
}

/**
 * Décompresse les fichiers multipart envoyés en gzip par le client mobile
 * (`Content-Type: application/gzip`, corps avec magic bytes 1f 8b).
 */
export function prepareIncomingUploadFile(
  file: Express.Multer.File,
): Express.Multer.File {
  if (!file?.buffer?.length) {
    return file;
  }
  const shouldGunzip =
    GZIP_MIMES.has((file.mimetype || '').toLowerCase()) ||
    isGzipBuffer(file.buffer);
  if (!shouldGunzip) {
    return file;
  }
  try {
    const decompressed = zlib.gunzipSync(file.buffer);
    let originalname = file.originalname;
    if (/\.gz$/i.test(originalname)) {
      originalname = originalname.replace(/\.gz$/i, '');
    }
    return {
      ...file,
      buffer: decompressed,
      size: decompressed.length,
      originalname,
      mimetype: mimeFromFilename(originalname),
    };
  } catch {
    return file;
  }
}

export function isAllowedGzipUploadMime(mime: string): boolean {
  return GZIP_MIMES.has((mime || '').toLowerCase());
}
