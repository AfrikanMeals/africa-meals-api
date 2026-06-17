import { BadRequestException } from '@nestjs/common';
import { extname } from 'path';
import type { Express } from 'express';

export type DetectedUploadKind =
  | 'jpeg'
  | 'png'
  | 'webp'
  | 'gif'
  | 'heic'
  | 'heif'
  | 'pdf'
  | 'webm'
  | 'mpeg'
  | 'wav'
  | 'ogg'
  | 'm4a'
  | 'unknown';

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.heic',
  '.heif',
  '.webm',
  '.m4a',
  '.mp3',
  '.wav',
  '.ogg',
  '.aac',
  '.pdf',
]);

const KIND_TO_MIME_PREFIXES: Record<DetectedUploadKind, string[]> = {
  jpeg: ['image/jpeg', 'image/jpg'],
  png: ['image/png'],
  webp: ['image/webp'],
  gif: ['image/gif'],
  heic: ['image/heic', 'image/heif'],
  heif: ['image/heif', 'image/heic'],
  pdf: ['application/pdf'],
  webm: ['audio/webm', 'video/webm'],
  mpeg: ['audio/mpeg', 'audio/mp3'],
  wav: ['audio/wav', 'audio/x-wav'],
  ogg: ['audio/ogg'],
  m4a: ['audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/3gpp'],
  unknown: [],
};

export function detectUploadFileKind(buffer: Buffer): DetectedUploadKind {
  if (!buffer?.length) {
    return 'unknown';
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpeg';
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return 'png';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  if (
    buffer.length >= 6 &&
    (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' ||
      buffer.subarray(0, 6).toString('ascii') === 'GIF89a')
  ) {
    return 'gif';
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF') {
    return 'pdf';
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return 'webm';
  }
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') {
    return 'mpeg';
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return 'mpeg';
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'OggS') {
    return 'ogg';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    return 'wav';
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii').toLowerCase();
    if (brand.startsWith('heic') || brand.startsWith('heim')) {
      return 'heic';
    }
    if (brand.startsWith('mif1') || brand.startsWith('heif')) {
      return 'heif';
    }
    return 'm4a';
  }
  return 'unknown';
}

function mimeMatchesKind(mime: string, kind: DetectedUploadKind): boolean {
  const normalized = (mime || '').trim().toLowerCase();
  if (!normalized || kind === 'unknown') {
    return false;
  }
  const allowed = KIND_TO_MIME_PREFIXES[kind];
  return allowed.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix};`),
  );
}

function assertAllowedExtension(filename: string): void {
  const ext = extname(filename || '').toLowerCase();
  if (!ext || !ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    throw new BadRequestException('invalid_file_extension');
  }
}

/** Valide magic bytes + extension déclarée (M-06). */
export function assertUploadFileSignature(file: Express.Multer.File): void {
  const buffer = file.buffer;
  if (!buffer?.length) {
    throw new BadRequestException('empty_file');
  }

  assertAllowedExtension(file.originalname || '');

  const kind = detectUploadFileKind(buffer);
  if (kind === 'unknown') {
    throw new BadRequestException('invalid_file_signature');
  }

  const mime = (file.mimetype || '').toLowerCase();
  if (mime && !mimeMatchesKind(mime, kind)) {
    throw new BadRequestException('file_signature_mime_mismatch');
  }
}
